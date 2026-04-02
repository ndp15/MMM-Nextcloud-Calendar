const NodeHelper = require("node_helper");
const axios = require("axios");
const ical = require("node-ical");
const { v4: uuidv4 } = require("uuid");

module.exports = NodeHelper.create({
    start: function () {
        console.log("MMM-Nextcloud-Calendar: Helper started (STABLE MODE)");
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "GET_EVENTS") {
            this.getAllEvents(payload);
        } else if (notification === "CREATE_EVENT") {
            this.createEvent(payload);
        } else if (notification === "UPDATE_EVENT") {
            this.updateEvent(payload);
        } else if (notification === "DELETE_EVENT") {
            this.deleteEvent(payload);
        }
    },

    // Fetches events from all configured calendars in sequence and sends the combined result.
    getAllEvents: async function (calendars) {
        const allEvents = [];
        const calList = Array.isArray(calendars) ? calendars : [calendars];

        for (const cal of calList) {
            try {
                console.log(`MMM-Nextcloud-Calendar: Loading ${cal.name}...`);
                const events = await this.fetchCalendar(cal);
                allEvents.push(...events);
                console.log(`MMM-Nextcloud-Calendar: ${events.length} events loaded.`);
            } catch (error) {
                let errMsg = error.message || "Unknown error";
                if (error.code) errMsg = `${error.code}: ${errMsg}`;
                if (error.response) {
                    errMsg = `HTTP ${error.response.status}: ${error.response.statusText || errMsg}`;
                    if (error.response.data) {
                        const data = typeof error.response.data === 'string'
                            ? error.response.data.substring(0, 300)
                            : JSON.stringify(error.response.data).substring(0, 300);
                        console.error(`MMM-Nextcloud-Calendar: Response Data: ${data}`);
                    }
                }
                console.error(`MMM-Nextcloud-Calendar: Error with ${cal.name}: ${errMsg}`);
                console.error(`MMM-Nextcloud-Calendar: URL was: ${cal.url}`);
            }
        }

        allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

        this.sendSocketNotification("EVENTS_RESULT", {
            success: true,
            events: allEvents,
        });
    },

    // Downloads a single calendar via WebDAV with retry on timeout (up to 2 retries).
    fetchCalendar: async function (cal, retryCount = 0) {
        let cleanUrl = cal.url.replace("?export", "");
        if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1);

        const exportUrl = cleanUrl + "/?export";

        try {
            const response = await axios.get(exportUrl, {
                auth: { username: cal.user, password: cal.pass },
                headers: { "Content-Type": "text/calendar" },
                timeout: 90000
            });
            return this.parseCalendarData(response.data, cal, cleanUrl);
        } catch (error) {
            if ((error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') && retryCount < 2) {
                console.log(`MMM-Nextcloud-Calendar: Retry ${retryCount + 1} for ${cal.name}...`);
                await new Promise(r => setTimeout(r, 2000));
                return this.fetchCalendar(cal, retryCount + 1);
            }
            throw error;
        }
    },

    // Parses raw iCal data into structured event objects. Handles recurring and all-day events.
    parseCalendarData: function (data, cal, cleanUrl) {
        const parsed = ical.parseICS(data);
        const events = [];

        // Include events from 2 months ago up to 12 months ahead
        const minDate = new Date(); minDate.setMonth(minDate.getMonth() - 2);
        const maxDate = new Date(); maxDate.setMonth(maxDate.getMonth() + 12);

        for (const key in parsed) {
            const ev = parsed[key];
            if (ev.type !== "VEVENT") continue;

            const uid = ev.uid || key;
            const filename = uid.includes(".ics") ? uid : uid + ".ics";
            const href = cleanUrl + "/" + filename;

            if (ev.rrule) {
                try {
                    const dates = ev.rrule.between(minDate, maxDate, true);
                    let isAllDay = ev.start.dateOnly || false;

                    if (!isAllDay && ev.start && ev.end) {
                        const duration = ev.end.getTime() - ev.start.getTime();
                        // Exact 24h multiples indicate all-day events
                        if (duration > 0 && duration % 86400000 === 0) {
                            isAllDay = true;
                        } else {
                            // Midnight UTC start with duration >= 23h also treated as all-day
                            const isMidnightUTC = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
                            if (isMidnightUTC(ev.start) && duration >= 82800000) {
                                isAllDay = true;
                            }
                        }
                    }

                    // Calculate duration in whole days (iCal DTEND is exclusive)
                    let durationDays = 1;
                    if (isAllDay && ev.end) {
                        const startDay = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
                        const endDay = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate());
                        durationDays = Math.round((endDay - startDay) / 86400000);
                        if (durationDays < 1) durationDays = 1;
                    }
                    const durationMs = (ev.end ? ev.end.getTime() : ev.start.getTime()) - ev.start.getTime();

                    // Format date as local ISO string without UTC conversion
                    const toLocalISOString = (d) => {
                        const pad = (n) => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    };

                    dates.forEach(date => {
                        let start, end, startStr, endStr;

                        if (isAllDay) {
                            start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
                            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + durationDays, 0, 0, 0);
                            startStr = toLocalISOString(start);
                            endStr = toLocalISOString(end);
                        } else {
                            start = new Date(date);
                            end = new Date(start.getTime() + durationMs);
                            startStr = start.toISOString();
                            endStr = end.toISOString();
                        }

                        events.push({
                            title: ev.summary || "Untitled",
                            start: startStr,
                            end: endStr,
                            isAllDay: isAllDay,
                            isRecurring: true,
                            rrule: ev.rrule.toString(),
                            location: ev.location || "",
                            description: ev.description || "",
                            attendees: ev.attendee ? (Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee]).map(a => typeof a === 'string' ? a.replace("mailto:", "") : (a.params?.CN || "")) : [],
                            calendarName: cal.name,
                            calendarColor: cal.color,
                            calendarUser: cal.user,
                            calendarPass: cal.pass,
                            href: href,
                            uid: uid
                        });
                    });
                } catch (e) { console.log("RRULE error:", e); }
            } else {
                // Single (non-recurring) event
                const start = new Date(ev.start);
                const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
                let isAllDay = ev.start.dateOnly || false;

                if (!isAllDay && ev.end) {
                    const duration = end.getTime() - start.getTime();
                    if (duration > 0 && duration % 86400000 === 0) {
                        isAllDay = true;
                    } else {
                        const isMidnightUTC = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
                        if (isMidnightUTC(start) && duration >= 82800000) {
                            isAllDay = true;
                        }
                    }
                }

                // Use local date strings for all-day events to avoid timezone shifts
                const toLocalISO = (d) => {
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                };

                if (end >= minDate && start <= maxDate) {
                    events.push({
                        title: ev.summary || "Untitled",
                        start: isAllDay ? toLocalISO(start) : start.toISOString(),
                        end: isAllDay ? toLocalISO(end) : end.toISOString(),
                        isAllDay: isAllDay,
                        isRecurring: false,
                        location: ev.location || "",
                        description: ev.description || "",
                        attendees: ev.attendee ? (Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee]).map(a => typeof a === 'string' ? a.replace("mailto:", "") : (a.params?.CN || "")) : [],
                        calendarName: cal.name,
                        calendarColor: cal.color,
                        calendarUser: cal.user,
                        calendarPass: cal.pass,
                        href: href,
                        uid: uid
                    });
                }
            }
        }
        return events;
    },

    // Creates a new iCal event via HTTP PUT on the WebDAV server.
    createEvent: async function (payload) {
        try {
            const { calendar, event } = payload;

            console.log("MMM-Nextcloud-Calendar: CREATE_EVENT received");
            console.log("MMM-Nextcloud-Calendar: Calendar URL:", calendar?.url);
            console.log("MMM-Nextcloud-Calendar: Event title:", event?.title);

            if (!calendar || !calendar.url || !calendar.user || !calendar.pass) {
                throw new Error("Missing calendar credentials (URL/user/pass)");
            }

            const uid = uuidv4();
            const filename = uid + ".ics";

            // Format date as compact UTC string: YYYYMMDDTHHMMSSZ
            const format = (d) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const formatDate = (d) => {
                const date = new Date(d);
                return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
            };

            const dtstamp = format(new Date());
            let dtstart, dtend;

            if (event.isAllDay) {
                // iCalendar: DTEND is exclusive for all-day events, so add 1 day
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);

                if (endDate <= startDate) {
                    endDate.setTime(startDate.getTime() + 86400000);
                } else {
                    endDate.setTime(endDate.getTime() + 86400000);
                }

                dtstart = `DTSTART;VALUE=DATE:${formatDate(startDate)}`;
                dtend = `DTEND;VALUE=DATE:${formatDate(endDate)}`;
            } else {
                dtstart = `DTSTART:${format(event.start)}`;
                dtend = `DTEND:${format(event.end)}`;
            }

            const lines = [
                "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MMM-Nextcloud//EN",
                "BEGIN:VEVENT",
                `UID:${uid}`, `DTSTAMP:${dtstamp}`,
                dtstart, dtend,
                `SUMMARY:${event.title}`
            ];
            if (event.location) lines.push(`LOCATION:${event.location}`);
            if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`);
            if (event.recurrence) lines.push(`RRULE:FREQ=${event.recurrence}`);

            lines.push("END:VEVENT", "END:VCALENDAR");

            let url = calendar.url.replace("?export", "");
            if (!url.endsWith("/")) url += "/";
            const putUrl = url + filename;

            console.log("MMM-Nextcloud-Calendar: PUT URL:", putUrl);

            await axios.put(putUrl, lines.join("\r\n"), {
                auth: { username: calendar.user, password: calendar.pass },
                headers: { "Content-Type": "text/calendar; charset=utf-8" },
                timeout: 60000
            });

            console.log("MMM-Nextcloud-Calendar: Event created successfully!");
            this.sendSocketNotification("CREATE_RESULT", { success: true });
        } catch (error) {
            let errMsg = error.message || "Unknown error";
            if (error.code) errMsg = `${error.code}: ${errMsg}`;
            if (error.response) {
                errMsg = `HTTP ${error.response.status}: ${error.response.statusText}`;
                if (error.response.data) {
                    const data = typeof error.response.data === 'string'
                        ? error.response.data.substring(0, 300)
                        : JSON.stringify(error.response.data).substring(0, 300);
                    console.error("MMM-Nextcloud-Calendar: Create response data:", data);
                }
            }
            console.error("MMM-Nextcloud-Calendar: Create error:", errMsg);
            this.sendSocketNotification("CREATE_RESULT", { success: false, error: errMsg });
        }
    },

    // Updates an existing event by overwriting it via PUT using the existing UID and href.
    updateEvent: async function (payload) {
        try {
            const { calendar, event, existingHref, existingUid } = payload;

            const uid = existingUid;

            const format = (d) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const formatDate = (d) => {
                const date = new Date(d);
                return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
            };

            const dtstamp = format(new Date());
            let dtstart, dtend;

            if (event.isAllDay) {
                // DTEND is exclusive for all-day events
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);
                if (endDate <= startDate) {
                    endDate.setTime(startDate.getTime() + 86400000);
                } else {
                    endDate.setTime(endDate.getTime() + 86400000);
                }
                dtstart = `DTSTART;VALUE=DATE:${formatDate(startDate)}`;
                dtend = `DTEND;VALUE=DATE:${formatDate(endDate)}`;
            } else {
                dtstart = `DTSTART:${format(event.start)}`;
                dtend = `DTEND:${format(event.end)}`;
            }

            const lines = [
                "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MMM-Nextcloud//EN",
                "BEGIN:VEVENT",
                `UID:${uid}`, `DTSTAMP:${dtstamp}`,
                dtstart, dtend,
                `SUMMARY:${event.title}`
            ];
            if (event.location) lines.push(`LOCATION:${event.location}`);
            if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`);
            if (event.recurrence) lines.push(`RRULE:FREQ=${event.recurrence}`);

            lines.push("END:VEVENT", "END:VCALENDAR");

            const putUrl = existingHref.replace("?export", "");

            console.log("Update event:", putUrl);

            await axios.put(putUrl, lines.join("\r\n"), {
                auth: { username: calendar.user, password: calendar.pass },
                headers: { "Content-Type": "text/calendar; charset=utf-8" },
                timeout: 60000
            });

            console.log("Update successful!");
            this.sendSocketNotification("UPDATE_RESULT", { success: true });
        } catch (error) {
            console.error("Update error:", error.message);
            this.sendSocketNotification("UPDATE_RESULT", { success: false, error: error.message });
        }
    },

    // Deletes an event by its WebDAV href. Treats 404 as success (already deleted).
    deleteEvent: async function (payload) {
        try {
            const { href, user, pass } = payload;

            const deleteUrl = href.replace("?export", "");

            console.log("Deleting:", deleteUrl);

            await axios.delete(deleteUrl, {
                auth: { username: user, password: pass },
                timeout: 120000,
                headers: {
                    "User-Agent": "MMM-Nextcloud-Calendar/2.0",
                    "Accept": "*/*"
                }
            });

            console.log("Delete successful!");
            this.sendSocketNotification("DELETE_RESULT", { success: true });

        } catch (error) {
            console.error("Delete error:", error.message);

            // 404 means already gone - treat as success
            if (error.response && error.response.status === 404) {
                console.log("File was already deleted (404)");
                this.sendSocketNotification("DELETE_RESULT", { success: true });
                return;
            }

            if (error.code === "ECONNABORTED") {
                console.error("Server timeout - try again later");
            }

            this.sendSocketNotification("DELETE_RESULT", { success: false, error: error.message });
        }
    }
}
);
