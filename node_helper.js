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

    /**
     * Initiates parallel WebDAV calendar fetches for multiple distinct configurations.
     * Maps error traces comprehensively per instance if execution fails.
     * @param {Object|Object[]} calendars - The selected sources from module config.
     * @returns {Promise<void>} Sends "EVENTS_RESULT" socket notification upon success.
     */
    getAllEvents: async function (calendars) {
        const allEvents = [];
        // Config can be an array or a single object
        const calList = Array.isArray(calendars) ? calendars : [calendars];

        for (const cal of calList) {
            try {
                console.log(`MMM-Nextcloud-Calendar: Loading ${cal.name}...`);
                const events = await this.fetchCalendar(cal);
                allEvents.push(...events);
                console.log(`MMM-Nextcloud-Calendar: ${events.length} events loaded.`);
            } catch (error) {
                // Detailed error information
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

    /**
     * Fetches the calendar data successfully, with built-in retry logic logic and timeout.
     * @param {Object} cal - The calendar configuration.
     * @param {number} retryCount - Current attempt iteration count.
     * @returns {Promise<Object[]>} A promise that resolves to an array of parsed calendar events.
     */
    fetchCalendar: async function (cal, retryCount = 0) {
        // Build a simple URL: Base URL + ?export
        // Remove an existing export query argument just in case the user config has it
        let cleanUrl = cal.url.replace("?export", "");
        if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1); // Remove trailing slash for consistency

        const exportUrl = cleanUrl + "/?export";

        try {
            const response = await axios.get(exportUrl, {
                auth: { username: cal.user, password: cal.pass },
                headers: { "Content-Type": "text/calendar" },
                timeout: 90000 // 90s timeout
            });
            return this.parseCalendarData(response.data, cal, cleanUrl);
        } catch (error) {
            // Re-try logic up to 3 times on timeout
            if ((error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') && retryCount < 2) {
                console.log(`MMM-Nextcloud-Calendar: Retry ${retryCount + 1} for ${cal.name}...`);
                await new Promise(r => setTimeout(r, 2000)); // Wait 2s
                return this.fetchCalendar(cal, retryCount + 1);
            }
            throw error;
        }
    },

    /**
     * Processes fetched calendar raw ICAL format string into structured JavaScript events.
     * Maps recurrent, all-day and scheduled events accordingly within a specific timeframe.
     * @param {string} data - ICAL string feed.
     * @param {Object} cal - Configuration attributes bound to the respective calendar scope.
     * @param {string} cleanUrl - The sanitized WebDAV link serving as the origin.
     * @returns {Object[]} Parsed event items structured by the helper.
     */
    parseCalendarData: function (data, cal, cleanUrl) {
        const parsed = ical.parseICS(data);
        const events = [];

        // Timeframe: -2 months to +12 months
        const minDate = new Date(); minDate.setMonth(minDate.getMonth() - 2);
        const maxDate = new Date(); maxDate.setMonth(maxDate.getMonth() + 12);

        for (const key in parsed) {
            const ev = parsed[key];
            if (ev.type !== "VEVENT") continue;

            // Guess UID & Filename (used for deleting events)
            const uid = ev.uid || key;
            const filename = uid.includes(".ics") ? uid : uid + ".ics";
            // Build absolute href path
            const href = cleanUrl + "/" + filename;

            // Calculate recurrent events
            if (ev.rrule) {
                try {
                    // Extract all recurring dates within the timeframe
                    const dates = ev.rrule.between(minDate, maxDate, true);
                    let isAllDay = ev.start.dateOnly || false;

                    // Heuristics: Midnight-to-Midnight UTC or spanning exactly 24h
                    if (!isAllDay && ev.start && ev.end) {
                        const duration = ev.end.getTime() - ev.start.getTime();
                        // 1. Exact 24h multiples to catch timezone offset events (e.g. 01:00-01:00)
                        if (duration > 0 && duration % 86400000 === 0) {
                            isAllDay = true;
                        }
                        // 2. Fallback: Identify midnight UTC starts (which might indicate stripped timezone data)
                        else {
                            const isMidnightUTC = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
                            if (isMidnightUTC(ev.start) && duration >= 82800000) { // >= 23h
                                isAllDay = true;
                            }
                        }
                    }

                    // For all-day events: Measure duration strictly in days
                    // Eliminating milliseconds safeguards from internal timezone offset faults
                    let durationDays = 1;
                    if (isAllDay && ev.end) {
                        // iCal: DTEND is exclusive
                        const startDay = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
                        const endDay = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate());
                        durationDays = Math.round((endDay - startDay) / 86400000);
                        if (durationDays < 1) durationDays = 1;
                    }
                    const durationMs = (ev.end ? ev.end.getTime() : ev.start.getTime()) - ev.start.getTime();

                    // Helper: Output localized ISO-string whilst skipping UTC conversion
                    const toLocalISOString = (d) => {
                        const pad = (n) => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    };

                    dates.forEach(date => {
                        let start, end, startStr, endStr;

                        if (isAllDay) {
                            // Reset recurrence results consistently back to local midnight constraints
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
                } catch (e) { console.log("RRULE Fehler:", e); }
            } else {
                // Einzeltermin
                const start = new Date(ev.start);
                const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
                let isAllDay = ev.start.dateOnly || false;

                // Heuristik auch für Einzeltermine: Midnight-to-Midnight UTC oder exakt 24h
                if (!isAllDay && ev.end) {
                    const duration = end.getTime() - start.getTime();
                    // 1. Exakt 24h-Vielfache
                    if (duration > 0 && duration % 86400000 === 0) {
                        isAllDay = true;
                    }
                    // 2. Fallback: Start um Mitternacht UTC
                    else {
                        const isMidnightUTC = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
                        if (isMidnightUTC(start) && duration >= 82800000) { // >= 23h
                            isAllDay = true;
                        }
                    }
                }

                // Für ganztägige Einzeltermine: lokale Datums-Strings verwenden
                const toLocalISO = (d) => {
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                };

                if (end >= minDate && start <= maxDate) {
                    events.push({
                        title: ev.summary || "Ohne Titel",
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

    createEvent: async function (payload) {
        try {
            const { calendar, event } = payload;

            // Debug logging
            console.log("MMM-Nextcloud-Calendar: CREATE_EVENT empfangen");
            console.log("MMM-Nextcloud-Calendar: Kalender URL:", calendar?.url);
            console.log("MMM-Nextcloud-Calendar: Event Titel:", event?.title);

            if (!calendar || !calendar.url || !calendar.user || !calendar.pass) {
                throw new Error("Kalender-Daten fehlen (URL/User/Pass)");
            }

            const uid = uuidv4();
            const filename = uid + ".ics";

            // Formatierung (YYYYMMDD...)
            const format = (d) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const formatDate = (d) => {
                const date = new Date(d);
                return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
            };

            const dtstamp = format(new Date());
            let dtstart, dtend;

            if (event.isAllDay) {
                // iCalendar: DTEND is exclusive for all-day events
                // A 1-day event on Jan 14 needs DTEND = Jan 15
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);

                // Make sure end is at least start + 1 day for all-day events
                if (endDate <= startDate) {
                    endDate.setTime(startDate.getTime() + 86400000); // +1 day
                } else {
                    // Add 1 day to make DTEND exclusive
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

            // URL bauen
            let url = calendar.url.replace("?export", "");
            if (!url.endsWith("/")) url += "/";
            const putUrl = url + filename;

            console.log("MMM-Nextcloud-Calendar: PUT URL:", putUrl);

            await axios.put(putUrl, lines.join("\r\n"), {
                auth: { username: calendar.user, password: calendar.pass },
                headers: { "Content-Type": "text/calendar; charset=utf-8" },
                timeout: 60000
            });

            console.log("MMM-Nextcloud-Calendar: Event erfolgreich erstellt!");
            this.sendSocketNotification("CREATE_RESULT", { success: true });
        } catch (error) {
            let errMsg = error.message || "Unbekannter Fehler";
            if (error.code) errMsg = `${error.code}: ${errMsg}`;
            if (error.response) {
                errMsg = `HTTP ${error.response.status}: ${error.response.statusText}`;
                if (error.response.data) {
                    const data = typeof error.response.data === 'string'
                        ? error.response.data.substring(0, 300)
                        : JSON.stringify(error.response.data).substring(0, 300);
                    console.error("MMM-Nextcloud-Calendar: Create Response Data:", data);
                }
            }
            console.error("MMM-Nextcloud-Calendar: Create Fehler:", errMsg);
            this.sendSocketNotification("CREATE_RESULT", { success: false, error: errMsg });
        }
    },

    // UPDATE: Überschreibt einen existierenden Termin via PUT auf die existierende URL
    updateEvent: async function (payload) {
        try {
            const { calendar, event, existingHref, existingUid } = payload;

            // Wir verwenden die existierende UID und href
            const uid = existingUid;

            // Formatierung
            const format = (d) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const formatDate = (d) => {
                const date = new Date(d);
                return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
            };

            const dtstamp = format(new Date());
            let dtstart, dtend;

            if (event.isAllDay) {
                // iCalendar: DTEND ist exklusiv für ganztägige Events → +1 Tag
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

            // PUT auf die existierende href URL
            const putUrl = existingHref.replace("?export", "");

            console.log("Update Event:", putUrl);

            await axios.put(putUrl, lines.join("\r\n"), {
                auth: { username: calendar.user, password: calendar.pass },
                headers: { "Content-Type": "text/calendar; charset=utf-8" },
                timeout: 60000
            });

            console.log("Update erfolgreich!");
            this.sendSocketNotification("UPDATE_RESULT", { success: true });
        } catch (error) {
            console.error("Update Fehler:", error.message);
            this.sendSocketNotification("UPDATE_RESULT", { success: false, error: error.message });
        }
    },

    deleteEvent: async function (payload) {
        try {
            const { href, user, pass } = payload;

            // URL bereinigen (kein encoding hier - axios macht das)
            const deleteUrl = href.replace("?export", "");

            console.log("Lösche:", deleteUrl);

            // Request mit langem Timeout - Nextcloud kann langsam sein
            await axios.delete(deleteUrl, {
                auth: { username: user, password: pass },
                timeout: 120000, // 2 Minuten Timeout!
                headers: {
                    "User-Agent": "MMM-Nextcloud-Calendar/2.0",
                    "Accept": "*/*"
                }
            });

            console.log("Löschen erfolgreich!");
            this.sendSocketNotification("DELETE_RESULT", { success: true });

        } catch (error) {
            console.error("Delete Fehler:", error.message);

            // 404 = Datei schon weg = Erfolg
            if (error.response && error.response.status === 404) {
                console.log("Datei war bereits gelöscht (404)");
                this.sendSocketNotification("DELETE_RESULT", { success: true });
                return;
            }

            // Timeout-spezifische Meldung
            if (error.code === "ECONNABORTED") {
                console.error("Server Timeout - versuche es später erneut");
            }

            this.sendSocketNotification("DELETE_RESULT", { success: false, error: error.message });
        }
    }
}
);
