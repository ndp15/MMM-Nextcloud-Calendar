const NodeHelper = require("node_helper"); // Test
const axios = require("axios");
const ical = require("node-ical");
const { v4: uuidv4 } = require("uuid");

module.exports = NodeHelper.create({
    start: function () {
        console.log("MMM-NextcloudManager: Helper gestartet (STABLE MODE)");
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

    getAllEvents: async function (calendars) {
        const allEvents = [];
        // Config kann Array oder einzelnes Objekt sein
        const calList = Array.isArray(calendars) ? calendars : [calendars];

        for (const cal of calList) {
            try {
                console.log(`MMM-NextcloudManager: Lade ${cal.name}...`);
                const events = await this.fetchCalendar(cal);
                allEvents.push(...events);
                console.log(`MMM-NextcloudManager: ${events.length} Events geladen.`);
            } catch (error) {
                // Detaillierte Fehlerinfo
                let errMsg = error.message || "Unbekannter Fehler";
                if (error.code) errMsg = `${error.code}: ${errMsg}`;
                if (error.response) {
                    errMsg = `HTTP ${error.response.status}: ${error.response.statusText || errMsg}`;
                    if (error.response.data) {
                        const data = typeof error.response.data === 'string'
                            ? error.response.data.substring(0, 300)
                            : JSON.stringify(error.response.data).substring(0, 300);
                        console.error(`MMM-NextcloudManager: Response Data: ${data}`);
                    }
                }
                console.error(`MMM-NextcloudManager: Fehler bei ${cal.name}: ${errMsg}`);
                console.error(`MMM-NextcloudManager: URL war: ${cal.url}`);
            }
        }

        allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

        this.sendSocketNotification("EVENTS_RESULT", {
            success: true,
            events: allEvents,
        });
    },

    fetchCalendar: async function (cal, retryCount = 0) {
        // Wir bauen die URL ganz simpel: Basis-URL + ?export
        // Wichtig: Wir entfernen ein eventuelles ?export aus der Config, falls du es aus Versehen drin hast
        let cleanUrl = cal.url.replace("?export", "");
        if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1); // Slash am Ende weg für Konsistenz

        const exportUrl = cleanUrl + "/?export";

        try {
            const response = await axios.get(exportUrl, {
                auth: { username: cal.user, password: cal.pass },
                headers: { "Content-Type": "text/calendar" },
                timeout: 90000 // 90s Timeout (erhöht von 60s)
            });
            return this.parseCalendarData(response.data, cal, cleanUrl);
        } catch (error) {
            // Bei Timeout: bis zu 3 Versuche
            if ((error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') && retryCount < 2) {
                console.log(`MMM-NextcloudManager: Retry ${retryCount + 1} für ${cal.name}...`);
                await new Promise(r => setTimeout(r, 2000)); // 2s warten
                return this.fetchCalendar(cal, retryCount + 1);
            }
            throw error;
        }
    },

    parseCalendarData: function (data, cal, cleanUrl) {
        const parsed = ical.parseICS(data);
        const events = [];

        // Zeitfenster: -2 Monate bis +12 Monate
        const minDate = new Date(); minDate.setMonth(minDate.getMonth() - 2);
        const maxDate = new Date(); maxDate.setMonth(maxDate.getMonth() + 12);

        for (const key in parsed) {
            const ev = parsed[key];
            if (ev.type !== "VEVENT") continue;

            // UID & Filename erraten (fürs Löschen)
            const uid = ev.uid || key;
            const filename = uid.includes(".ics") ? uid : uid + ".ics";
            // href bauen: Basis-URL (ohne ?export) + / + filename
            const href = cleanUrl + "/" + filename;

            // RRULE (Wiederholungen)
            if (ev.rrule) {
                try {
                    // Wir holen alle Wiederholungen im Zeitfenster
                    const dates = ev.rrule.between(minDate, maxDate, true);
                    let isAllDay = ev.start.dateOnly || false;

                    // Heuristik: Midnight-to-Midnight UTC oder exakt 24h
                    if (!isAllDay && ev.start && ev.end) {
                        const duration = ev.end.getTime() - ev.start.getTime();
                        // 1. Exakt 24h-Vielfache (fängt Zeitzonen-verschobene Events wie 01:00-01:00 ab)
                        if (duration > 0 && duration % 86400000 === 0) {
                            isAllDay = true;
                        }
                        // 2. Fallback: Start um Mitternacht UTC (fängt 23h-Events ab)
                        else {
                            const isMidnightUTC = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
                            if (isMidnightUTC(ev.start) && duration >= 82800000) { // >= 23h
                                isAllDay = true;
                            }
                        }
                    }

                    // Für ganztägige Events: Dauer in Tagen berechnen (nicht in ms)
                    // damit Zeitzonen-Offsets keine Rolle spielen
                    let durationDays = 1;
                    if (isAllDay && ev.end) {
                        // iCal: DTEND ist exklusiv, also DTSTART=20260210, DTEND=20260211 = 1 Tag
                        const startDay = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
                        const endDay = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate());
                        durationDays = Math.round((endDay - startDay) / 86400000);
                        if (durationDays < 1) durationDays = 1;
                    }
                    const durationMs = (ev.end ? ev.end.getTime() : ev.start.getTime()) - ev.start.getTime();

                    // Helper: lokales Datum als String ohne UTC-Konvertierung
                    const toLocalISOString = (d) => {
                        const pad = (n) => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    };

                    dates.forEach(date => {
                        let start, end, startStr, endStr;

                        if (isAllDay) {
                            // Ganztägige Events: auf lokale Mitternacht normalisieren
                            // rrule.between() kann Zeitzonen-Offsets einführen (z.B. UTC 00:00 → CET 01:00)
                            start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
                            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + durationDays, 0, 0, 0);
                            // Lokale Datums-Strings verwenden statt toISOString()
                            // toISOString() konvertiert zu UTC, was bei CET/CEST Mitternacht
                            // den Tag verschiebt (z.B. 12. Feb 00:00 CET → 11. Feb 23:00 UTC)
                            startStr = toLocalISOString(start);
                            endStr = toLocalISOString(end);
                        } else {
                            start = new Date(date);
                            end = new Date(start.getTime() + durationMs);
                            startStr = start.toISOString();
                            endStr = end.toISOString();
                        }

                        events.push({
                            title: ev.summary || "Ohne Titel",
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
            console.log("MMM-NextcloudManager: CREATE_EVENT empfangen");
            console.log("MMM-NextcloudManager: Kalender URL:", calendar?.url);
            console.log("MMM-NextcloudManager: Event Titel:", event?.title);

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

            console.log("MMM-NextcloudManager: PUT URL:", putUrl);

            await axios.put(putUrl, lines.join("\r\n"), {
                auth: { username: calendar.user, password: calendar.pass },
                headers: { "Content-Type": "text/calendar; charset=utf-8" },
                timeout: 60000
            });

            console.log("MMM-NextcloudManager: Event erfolgreich erstellt!");
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
                    console.error("MMM-NextcloudManager: Create Response Data:", data);
                }
            }
            console.error("MMM-NextcloudManager: Create Fehler:", errMsg);
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
                    "User-Agent": "MMM-NextcloudManager/2.0",
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