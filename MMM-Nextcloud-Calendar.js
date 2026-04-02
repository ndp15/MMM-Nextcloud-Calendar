 Module.register("MMM-Nextcloud-Calendar", { // eslint-disable-line no-unused-vars
    defaults: {
        calendars: [],
        refreshInterval: 1 * 60 * 1000, // 1 minute
    },

    events: [],
    selectedMonth: null,
    editingEvent: null,
    selectedCalendar: null,
    editStartDate: null,
    editEndDate: null,
    shiftActive: false,
    activeInputField: null,
    activeFilters: [],
    suggestionsTimer: null,
    holidaysCache: {},

    // Calculates Easter Sunday for a given year using the Gauss algorithm.
    calculateEaster: function (year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month, day);
    },

    // Returns Swiss public holidays for the given year, using the cache when available.
    getSwissHolidays: function (year) {
        if (this.holidaysCache[year]) {
            return this.holidaysCache[year];
        }

        const easter = this.calculateEaster(year);
        const holidays = [];

        // Fixed-date holidays
        holidays.push({ date: new Date(year, 0, 1), name: "Neujahr" });
        holidays.push({ date: new Date(year, 0, 2), name: "Berchtoldstag" });
        holidays.push({ date: new Date(year, 4, 1), name: "Tag der Arbeit" });
        holidays.push({ date: new Date(year, 7, 1), name: "Bundesfeier" });
        holidays.push({ date: new Date(year, 11, 25), name: "Weihnachten" });
        holidays.push({ date: new Date(year, 11, 26), name: "Stephanstag" });

        // Easter-relative holidays
        const easterTime = easter.getTime();
        holidays.push({ date: new Date(easterTime - 2 * 86400000), name: "Karfreitag" });
        holidays.push({ date: new Date(easterTime + 1 * 86400000), name: "Ostermontag" });
        holidays.push({ date: new Date(easterTime + 39 * 86400000), name: "Auffahrt" });
        holidays.push({ date: new Date(easterTime + 50 * 86400000), name: "Pfingstmontag" });

        this.holidaysCache[year] = holidays;
        return holidays;
    },

    // Returns holidays that fall on a specific day.
    getHolidaysForDay: function (y, m, d) {
        const holidays = this.getSwissHolidays(y);
        return holidays.filter(h => {
            return h.date.getFullYear() === y &&
                h.date.getMonth() === m &&
                h.date.getDate() === d;
        });
    },

    start: function () {
        Log.info("Starting module: " + this.name);
        const now = new Date();
        this.selectedMonth = { year: now.getFullYear(), month: now.getMonth() };
        if (this.config.calendars.length > 0) {
            this.selectedCalendar = this.config.calendars[0];
            // All calendars visible by default
            this.activeFilters = this.config.calendars.map(cal => cal.name);
        }
        this.loadEvents();
        this.scheduleRefresh();
    },

    getStyles: function () {
        return [
            "MMM-Nextcloud-Calendar.css",
            "node_modules/simple-keyboard/build/css/index.css"
        ];
    },

    getScripts: function () {
        return [
            this.file("node_modules/simple-keyboard/build/index.js")
        ];
    },

    scheduleRefresh: function () {
        setInterval(() => this.loadEvents(), this.config.refreshInterval);
    },

    loadEvents: function () {
        this.sendSocketNotification("GET_EVENTS", this.config.calendars);
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "EVENTS_RESULT" && payload.success) {
            this.events = payload.events;
            // Skip DOM update while the edit modal is open
            const editModalOpen = !document.getElementById("ncm-edit-modal")?.classList.contains("ncm-hidden");
            if (!editModalOpen) {
                this.updateDom();
            }
        } else if (notification === "CREATE_RESULT") {
            this.closeAllModals();
            if (payload.success) this.loadEvents();
            else this.showAlert("Fehler: " + payload.error);
        } else if (notification === "UPDATE_RESULT") {
            this.closeAllModals();
            if (payload.success) this.loadEvents();
            else this.showAlert("Fehler: " + payload.error);
        } else if (notification === "DELETE_RESULT") {
            this.closeAllModals();
            if (payload.success) this.loadEvents();
            else this.showAlert("Fehler: " + payload.error);
        }
    },

    getDom: function () {
        const w = document.createElement("div");
        w.className = "ncm-container";
        w.appendChild(this.createLegend());
        w.appendChild(this.createCalendarGrid());
        w.appendChild(this.createHeader());
        w.appendChild(this.createDayModal());
        w.appendChild(this.createDetailModal());
        w.appendChild(this.createEditModal());
        w.appendChild(this.createAlertModal());
        w.appendChild(this.createDrumPicker());

        return w;
    },

    // Returns an SVG icon string by name.
    icon: function (n) {
        const i = {
            left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>',
            right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>',
            close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
            trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
            loc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
            user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
            note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>',
            plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
            up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18,15 12,9 6,15"/></svg>',
            down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>',
            repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
        };
        return i[n] || "";
    },

    // Creates the "new event" button in the top-right corner.
    createAddButton: function () {
        const container = document.createElement("div");
        container.className = "ncm-add-container";

        const newBtn = document.createElement("button");
        newBtn.className = "ncm-btn ncm-btn-icon";
        newBtn.innerHTML = this.icon("plus");
        newBtn.title = "Neu";
        newBtn.addEventListener("click", () => this.openEditModal());

        container.appendChild(newBtn);
        return container;
    },

    // Creates the month navigation bar (prev/next arrows + month label).
    createHeader: function () {
        const h = document.createElement("div");
        h.className = "ncm-header";

        const nav = document.createElement("div");
        nav.className = "ncm-nav";

        const prev = document.createElement("button");
        prev.className = "ncm-btn ncm-btn-icon";
        prev.innerHTML = this.icon("left");
        prev.addEventListener("click", () => this.navigateMonth(-1));

        const lbl = document.createElement("span");
        lbl.className = "ncm-month-label";
        lbl.textContent = new Date(this.selectedMonth.year, this.selectedMonth.month).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

        const next = document.createElement("button");
        next.className = "ncm-btn ncm-btn-icon";
        next.innerHTML = this.icon("right");
        next.addEventListener("click", () => this.navigateMonth(1));

        nav.append(prev, lbl, next);
        h.appendChild(nav);
        return h;
    },

    // Builds the full monthly calendar grid with events assigned to slots.
    createCalendarGrid: function () {
        const self = this;
        const g = document.createElement("div");
        g.className = "ncm-calendar";

        const days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
        const hdr = document.createElement("div");
        hdr.className = "ncm-weekdays";
        days.forEach(d => {
            const c = document.createElement("div");
            c.className = "ncm-weekday";
            c.textContent = d;
            hdr.appendChild(c);
        });
        g.appendChild(hdr);

        const grid = document.createElement("div");
        grid.className = "ncm-days";

        const { year, month } = this.selectedMonth;
        const first = new Date(year, month, 1);
        const last  = new Date(year, month + 1, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);

        let dow = first.getDay() - 1;
        if (dow < 0) dow = 6;

        // Build the flat list of cell dates (null = padding cell from prev/next month)
        const cellDates = [];
        for (let i = dow - 1; i >= 0; i--) cellDates.push(null);
        for (let d = 1; d <= last.getDate(); d++) cellDates.push(new Date(year, month, d));
        const rem = (7 - ((dow + last.getDate()) % 7)) % 7;
        for (let i = 0; i < rem; i++) cellDates.push(null);

        const MAX_DISPLAY_EVENTS = 2;
        const CELL_PAD     = 5;

        // Returns the normalised end date for an event (all-day end is exclusive, so subtract 1 day)
        const normEnd = ev => {
            let e = new Date(ev.end);
            if (ev.isAllDay) e = new Date(e.getTime() - 86400000);
            e.setHours(0, 0, 0, 0);
            return e;
        };
        const isMultiDayEv = ev => {
            const s = new Date(ev.start); s.setHours(0, 0, 0, 0);
            return normEnd(ev).getTime() > s.getTime();
        };

        const allEvents = (this.events || []).filter(e => this.activeFilters.includes(e.calendarName));

        // Multi-day events first (longest first), then single-day by start time
        const sortedEvents = [...allEvents].sort((a, b) => {
            const aMulti = isMultiDayEv(a);
            const bMulti = isMultiDayEv(b);
            if (aMulti && !bMulti) return -1;
            if (!aMulti && bMulti) return 1;

            if (aMulti && bMulti) {
                const aDuration = normEnd(a).getTime() - new Date(a.start).setHours(0,0,0,0);
                const bDuration = normEnd(b).getTime() - new Date(b.start).setHours(0,0,0,0);
                if (bDuration !== aDuration) return bDuration - aDuration;
            }

            return new Date(a.start).getTime() - new Date(b.start).getTime();
        });

        // Assign each event to the lowest free slot across all cells it occupies
        const slotAssign = cellDates.map(() => []);

        sortedEvents.forEach(ev => {
            const evStart = new Date(ev.start); evStart.setHours(0, 0, 0, 0);
            const evEnd   = isMultiDayEv(ev) ? normEnd(ev) : evStart;

            const covered = [];
            cellDates.forEach((date, idx) => {
                if (!date) return;
                const d = new Date(date); d.setHours(0, 0, 0, 0);
                if (d >= evStart && d <= evEnd) covered.push(idx);
            });
            if (!covered.length) return;

            let slot = 0;
            while (true) {
                const isFree = covered.every(idx => !slotAssign[idx][slot]);
                if (isFree) break;
                slot++;
            }
            covered.forEach(idx => {
                slotAssign[idx][slot] = ev;
            });
        });

        const prevMonthDay = new Date(year, month, 0).getDate();

        cellDates.forEach((date, idx) => {
            let dayNum, isOther;
            if (date) {
                dayNum = date.getDate(); isOther = false;
            } else if (idx < dow) {
                dayNum = prevMonthDay - (dow - 1 - idx); isOther = true;
            } else {
                dayNum = idx - (dow + last.getDate()) + 1; isOther = true;
            }
            const isToday = date && date.getTime() === today.getTime();

            const cell = document.createElement("div");
            cell.className = "ncm-day" + (isOther ? " ncm-day-other" : "") + (isToday ? " ncm-day-today" : "");

            const num = document.createElement("div");
            num.className = "ncm-day-num";
            num.textContent = dayNum;
            if (!isOther && date) {
                const dateRef = new Date(date.getTime());
                num.style.cursor = "pointer";
                num.onclick = () => { self.openDayModal(dateRef); return false; };
                num.addEventListener("click", () => self.openDayModal(dateRef), false);
                num.addEventListener("touchend", e => { e.preventDefault(); self.openDayModal(dateRef); }, false);
            }
            cell.appendChild(num);

            if (isOther || !date) { grid.appendChild(cell); return; }

            const slots = slotAssign[idx] || [];

            const evCont = document.createElement("div");
            evCont.className = "ncm-day-events";
            evCont.style.display = "flex";
            evCont.style.flexDirection = "column";
            evCont.style.gap = "2px";
            evCont.style.marginTop = "2px";

            let renderedCount = 0;

            for (let slot = 0; slot < MAX_DISPLAY_EVENTS; slot++) {
                const ev = slots[slot];

                if (!ev) {
                    const hasHigher = slots.slice(slot + 1, MAX_DISPLAY_EVENTS).some(e => e);
                    if (hasHigher) {
                        const spacer = document.createElement("div");
                        spacer.style.height = "18px";
                        evCont.appendChild(spacer);
                        renderedCount++;
                    }
                    continue;
                }

                const isMulti = isMultiDayEv(ev);
                const baseColor = ev.calendarColor || "#667eea";

                if (isMulti) {
                    const d = new Date(date); d.setHours(0, 0, 0, 0);
                    const evStart = new Date(ev.start); evStart.setHours(0, 0, 0, 0);
                    const evEnd   = normEnd(ev);

                    const weekIndices = cellDates.reduce((acc, d2, i2) => {
                        if (Math.floor(i2 / 7) === Math.floor(idx / 7) && d2) acc.push(i2);
                        return acc;
                    }, []);
                    const coveredInWeek = weekIndices.filter(i2 => slotAssign[i2][slot] === ev);
                    const isFirstInRow  = coveredInWeek[0] === idx;
                    const isLastInRow   = coveredInWeek[coveredInWeek.length - 1] === idx;
                    const isActualStart = d.getTime() === evStart.getTime();
                    const isActualEnd   = d.getTime() === evEnd.getTime();

                    const roundL = (isActualStart || isFirstInRow) ? "4px" : "0";
                    const roundR = (isActualEnd   || isLastInRow)  ? "4px" : "0";

                    const barWrapper = document.createElement("div");
                    barWrapper.className = "ncm-slot-row";

                    let mLeft = 0;
                    let pLeft = "";
                    if (!isActualStart) {
                        mLeft = isFirstInRow ? -CELL_PAD : -(CELL_PAD + 2);
                        pLeft = isFirstInRow ? (CELL_PAD + 6) + "px" : "0px";
                    }

                    let mRight = 0;
                    let pRight = "";
                    if (!isActualEnd) {
                        mRight = isLastInRow ? -CELL_PAD : -(CELL_PAD + 2);
                        pRight = "0px";
                    }

                    barWrapper.style.margin = `0 ${mRight}px 0 ${mLeft}px`;
                    barWrapper.style.height = "18px";

                    const bar = document.createElement("div");
                    bar.className       = "ncm-multiday-bar ncm-evt";
                    bar.style.height    = "100%";
                    bar.style.minHeight = "18px";
                    bar.style.background= self.hexToRgba(baseColor, 0.40);
                    bar.style.borderRadius = roundL + " " + roundR + " " + roundR + " " + roundL;
                    bar.style.display   = "flex";
                    bar.style.alignItems= "center";
                    bar.style.overflow  = "hidden";
                    bar.style.whiteSpace= "nowrap";
                    bar.style.fontSize  = "11px";
                    bar.style.color     = "#fff";
                    bar.style.boxSizing = "border-box";
                    bar.style.cursor    = "pointer";
                    bar.style.paddingTop = "0";
                    bar.style.paddingBottom = "0";
                    if (pLeft !== "") bar.style.paddingLeft = pLeft;
                    if (pRight !== "") bar.style.paddingRight = pRight;

                    if (isActualStart || isFirstInRow) {
                        bar.style.borderLeft = "3px solid " + baseColor;
                        bar.textContent = ev.title;
                    } else {
                        bar.style.borderLeft = "none";
                        bar.textContent = " ";
                    }

                    const evRef = ev;
                    bar.onclick = e => { e.stopPropagation(); self.openDetailModal(evRef); };
                    bar.addEventListener("touchend", e => { e.preventDefault(); e.stopPropagation(); self.openDetailModal(evRef); }, false);
                    barWrapper.appendChild(bar);
                    evCont.appendChild(barWrapper);
                    renderedCount++;
                } else {
                    const dot = document.createElement("div");
                    dot.className = "ncm-evt";
                    dot.style.height = "18px";
                    dot.style.display = "flex";
                    dot.style.alignItems = "center";

                    if (ev.isAllDay) {
                        dot.textContent = ev.title;
                        dot.style.borderRadius = "10px";
                        dot.style.backgroundColor = self.hexToRgba(baseColor, 0.5);
                    } else {
                        dot.style.backgroundColor = self.hexToRgba(baseColor, 0.35);
                        dot.style.borderLeft = `3px solid ${baseColor}`;
                        const s  = new Date(ev.start);
                        const e2 = new Date(ev.end);
                        const fmt = t => `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
                        dot.textContent = `${ev.title} ${fmt(s)}-${fmt(e2)}`;
                    }

                    if (ev.isRecurring && date.toDateString() === new Date(ev.start).toDateString()) {
                        const ico = document.createElement("span");
                        ico.className = "ncm-evt-repeat-icon";
                        ico.innerHTML = self.icon("repeat");
                        dot.appendChild(ico);
                    }

                    dot.style.cursor = "pointer";
                    const evRef = ev;
                    dot.onclick = () => self.openDetailModal(evRef);
                    dot.addEventListener("touchend", e => { e.preventDefault(); self.openDetailModal(evRef); }, false);
                    evCont.appendChild(dot);
                    renderedCount++;
                }
            }

            const hiddenCount = slots.slice(MAX_DISPLAY_EVENTS).filter(e => e).length;

            if (hiddenCount > 0) {
                const m = document.createElement("div");
                m.className = "ncm-more";
                m.textContent = `+${hiddenCount}`;
                const dateRef = new Date(date.getTime());
                m.onclick = e => { e.stopPropagation(); self.openDayModal(dateRef); };
                m.addEventListener("touchend", e => { e.preventDefault(); e.stopPropagation(); self.openDayModal(dateRef); }, false);
                evCont.appendChild(m);
            }

            if (renderedCount > 0 || hiddenCount > 0) {
                cell.appendChild(evCont);
            }

            // Append holidays below event bars so they don't affect slot positions
            const holidays = this.getHolidaysForDay(date.getFullYear(), date.getMonth(), date.getDate());
            if (holidays.length) {
                const hCont = document.createElement("div");
                hCont.className = "ncm-day-holidays";
                holidays.forEach(h => {
                    const hol = document.createElement("div");
                    hol.className = "ncm-evt-holiday";
                    hol.textContent = h.name;
                    hCont.appendChild(hol);
                });
                cell.appendChild(hCont);
            }

            grid.appendChild(cell);
        });

        g.appendChild(grid);
        return g;
    },

    // Legacy cell builder kept for compatibility - grid is now built inline.
    createDayCell: function (day, isOther, isToday = false, date = null) {
        const self = this;
        const c = document.createElement("div");
        c.className = "ncm-day" + (isOther ? " ncm-day-other" : "") + (isToday ? " ncm-day-today" : "");
        const num = document.createElement("div");
        num.className = "ncm-day-num";
        num.textContent = day;
        if (!isOther && date) {
            const dateRef = new Date(date.getTime());
            num.style.cursor = "pointer";
            num.onclick = () => { self.openDayModal(dateRef); return false; };
            num.addEventListener("click", () => self.openDayModal(dateRef), false);
            num.addEventListener("touchend", e => { e.preventDefault(); self.openDayModal(dateRef); }, false);
        }
        c.appendChild(num);
        return c;
    },

    // Builds the legend row with calendar color dots and a "New" button on the right.
    createLegend: function () {
        const self = this;
        const wrapper = document.createElement("div");
        wrapper.className = "ncm-legend-wrapper";

        // Show "Today" button only when viewing a month other than the current one
        const now = new Date();
        const isCurrentMonth = this.selectedMonth.year === now.getFullYear() && this.selectedMonth.month === now.getMonth();
        if (!isCurrentMonth) {
            const currentBefore = (now.getFullYear() * 12 + now.getMonth()) < (this.selectedMonth.year * 12 + this.selectedMonth.month);
            const arrow = currentBefore ? this.icon("left") : this.icon("right");

            const todayBtn = document.createElement("button");
            todayBtn.className = "ncm-btn ncm-btn-today";
            todayBtn.innerHTML = (currentBefore ? arrow + " " : "") + "Heute" + (!currentBefore ? " " + arrow : "");
            todayBtn.addEventListener("click", () => {
                const today = new Date();
                this.selectedMonth = { year: today.getFullYear(), month: today.getMonth() };
                this.updateDom();
            });
            wrapper.appendChild(todayBtn);
        }

        const leg = document.createElement("div");
        leg.className = "ncm-legend";

        this.config.calendars.forEach(cal => {
            const item = document.createElement("div");
            const isActive = self.activeFilters.includes(cal.name);
            item.className = "ncm-legend-item" + (isActive ? "" : " ncm-legend-inactive");

            const dot = document.createElement("span");
            dot.className = "ncm-legend-dot";
            dot.style.backgroundColor = cal.color;

            const name = document.createElement("span");
            name.textContent = cal.name;

            item.addEventListener("click", function () {
                self.toggleCalendarFilter(cal.name);
            });

            item.append(dot, name);
            leg.appendChild(item);
        });

        const newBtn = document.createElement("button");
        newBtn.className = "ncm-btn ncm-btn-icon";
        newBtn.innerHTML = this.icon("plus");
        newBtn.title = "Neu";
        newBtn.addEventListener("click", () => this.openEditModal());

        wrapper.appendChild(leg);
        wrapper.appendChild(newBtn);

        return wrapper;
    },

    // Returns a human-readable label for an RRULE recurrence frequency.
    getRecurrenceLabel: function (rrule) {
        if (!rrule) return "Serie";
        if (rrule.includes("FREQ=DAILY")) return "Täglich";
        if (rrule.includes("FREQ=WEEKLY")) return "Wöchentlich";
        if (rrule.includes("FREQ=MONTHLY")) return "Monatlich";
        if (rrule.includes("FREQ=YEARLY")) return "Jährlich";
        return "Serie";
    },

    // Returns the FREQ value from an RRULE string (e.g. "WEEKLY").
    getRecurrenceFreq: function (rrule) {
        if (!rrule) return "";
        if (rrule.includes("FREQ=DAILY")) return "DAILY";
        if (rrule.includes("FREQ=WEEKLY")) return "WEEKLY";
        if (rrule.includes("FREQ=MONTHLY")) return "MONTHLY";
        if (rrule.includes("FREQ=YEARLY")) return "YEARLY";
        return "";
    },

    // Toggles a calendar in/out of the active filter list and re-renders.
    toggleCalendarFilter: function (calendarName) {
        const index = this.activeFilters.indexOf(calendarName);
        if (index > -1) {
            this.activeFilters.splice(index, 1);
        } else {
            this.activeFilters.push(calendarName);
        }
        this.updateDom();
    },

    // Returns events that overlap a given day, respecting active calendar filters.
    getEventsForDay: function (y, m, d) {
        const ds = new Date(y, m, d, 0, 0, 0);
        const de = new Date(y, m, d, 23, 59, 59);
        return this.events.filter(e => {
            if (!this.activeFilters.includes(e.calendarName)) {
                return false;
            }

            const start = new Date(e.start);
            let end = new Date(e.end);

            // iCalendar DTEND is exclusive for all-day events, subtract 1 day for display
            if (e.isAllDay) {
                end = new Date(end.getTime() - 86400000);
            }

            return start <= de && end >= ds;
        });
    },

    navigateMonth: function (dir) {
        let m = this.selectedMonth.month + dir;
        let y = this.selectedMonth.year;
        if (m > 11) { m = 0; y++; } else if (m < 0) { m = 11; y--; }
        this.selectedMonth = { year: y, month: m };
        this.updateDom();
    },

    // Creates the day-detail modal (lists all events for a tapped day).
    createDayModal: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-day-modal";

        const c = document.createElement("div");
        c.className = "ncm-modal-content";

        const cl = document.createElement("button");
        cl.className = "ncm-modal-close";
        cl.innerHTML = this.icon("close");
        cl.addEventListener("click", () => this.closeAllModals());

        const t = document.createElement("h3");
        t.id = "ncm-day-title";
        t.className = "ncm-modal-title";

        const l = document.createElement("div");
        l.id = "ncm-day-list";
        l.className = "ncm-evt-list";

        const add = document.createElement("button");
        add.id = "ncm-day-add";
        add.className = "ncm-btn ncm-btn-primary ncm-btn-full";
        add.textContent = "Neuer Termin";

        c.append(cl, t, l, add);
        m.appendChild(c);
        return m;
    },

    openDayModal: function (date) {
        const mod = document.getElementById("ncm-day-modal");
        document.getElementById("ncm-day-title").textContent = date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

        const list = document.getElementById("ncm-day-list");
        list.innerHTML = "";
        const evts = this.getEventsForDay(date.getFullYear(), date.getMonth(), date.getDate());
        if (evts.length === 0) {
            list.innerHTML = '<div class="ncm-empty">Keine Termine</div>';
        } else {
            evts.forEach(e => {
                const it = document.createElement("div");
                it.className = "ncm-evt-item";
                it.style.borderLeftColor = e.calendarColor;
                it.innerHTML = `<span class="ncm-evt-title">${e.title}</span><span class="ncm-evt-time">${this.formatTime(e)}</span>`;
                it.addEventListener("click", () => this.openDetailModal(e));
                list.appendChild(it);
            });
        }

        document.getElementById("ncm-day-add").onclick = () => { this.closeAllModals(); this.openEditModalForDate(date); };
        mod.classList.remove("ncm-hidden");
    },

    // Creates the event detail modal (read-only view with edit/delete actions).
    createDetailModal: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-detail-modal";

        const c = document.createElement("div");
        c.className = "ncm-modal-content";

        const cl = document.createElement("button");
        cl.className = "ncm-modal-close";
        cl.innerHTML = this.icon("close");
        cl.addEventListener("click", () => this.closeAllModals());

        const t = document.createElement("h3");
        t.id = "ncm-detail-title";
        t.className = "ncm-modal-title";

        const det = document.createElement("div");
        det.id = "ncm-detail-content";
        det.className = "ncm-details";

        const acts = document.createElement("div");
        acts.className = "ncm-actions";

        const ed = document.createElement("button");
        ed.id = "ncm-detail-edit";
        ed.className = "ncm-btn ncm-btn-secondary";
        ed.innerHTML = this.icon("edit") + " Bearbeiten";

        const del = document.createElement("button");
        del.id = "ncm-detail-delete";
        del.className = "ncm-btn ncm-btn-danger";
        del.innerHTML = this.icon("trash") + " Löschen";

        acts.append(ed, del);
        c.append(cl, t, det, acts);
        m.appendChild(c);
        return m;
    },

    // Escapes HTML special characters to prevent XSS in innerHTML assignments.
    escapeHtml: function (str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    openDetailModal: function (ev) {
        const self = this;
        const mod = document.getElementById("ncm-detail-modal");
        document.getElementById("ncm-detail-title").textContent = ev.title;

        const esc = (s) => self.escapeHtml(s);
        let html = `<div class="ncm-row"><span class="ncm-lbl">Kalender</span><span class="ncm-badge ncm-detail-badge" style="background:${esc(ev.calendarColor)}">${esc(ev.calendarName)}</span></div>`;
        html += `<div class="ncm-row"><span class="ncm-lbl">Zeit</span><span>${this.formatTime(ev)}</span></div>`;
        if (ev.location) html += `<div class="ncm-row"><span class="ncm-lbl">Ort</span><span>${esc(ev.location)}</span></div>`;
        if (ev.attendees?.length) html += `<div class="ncm-row"><span class="ncm-lbl">Personen</span><span>${esc(ev.attendees.join(", "))}</span></div>`;
        if (ev.description) html += `<div class="ncm-row"><span class="ncm-lbl">Notizen</span><span class="ncm-notes">${esc(ev.description)}</span></div>`;
        if (ev.isRecurring) {
            const recLabel = self.getRecurrenceLabel(ev.rrule);
            html += `<div class="ncm-row"><span class="ncm-lbl">Wiederholen</span><span>${self.icon("repeat")} ${esc(recLabel)}</span></div>`;
        }

        document.getElementById("ncm-detail-content").innerHTML = html;

        document.getElementById("ncm-detail-edit").onclick = () => {
            if (ev.isRecurring) {
                this.showRecurringChoice("Wiederkehrenden Termin bearbeiten?", "edit", (choice) => {
                    if (choice === "all") {
                        this.closeAllModals();
                        this.openEditModal(ev);
                    }
                });
            } else {
                this.closeAllModals();
                this.openEditModal(ev);
            }
        };
        document.getElementById("ncm-detail-delete").onclick = () => {
            if (ev.isRecurring) {
                this.showRecurringChoice("Wiederkehrenden Termin löschen?", "delete", (choice) => {
                    if (choice === "all") {
                        this.showLoading("Termin wird gelöscht…");
                        this.sendSocketNotification("DELETE_EVENT", { href: ev.href, user: ev.calendarUser, pass: ev.calendarPass });
                    }
                });
            } else {
                this.showConfirm("Termin wirklich löschen?", () => {
                    this.showLoading("Termin wird gelöscht…");
                    this.sendSocketNotification("DELETE_EVENT", { href: ev.href, user: ev.calendarUser, pass: ev.calendarPass });
                });
            }
        };
        mod.classList.remove("ncm-hidden");
    },

    // Creates the iOS-style event edit modal with all input sections.
    createEditModal: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-edit-modal";

        const c = document.createElement("div");
        c.className = "ncm-modal-content ncm-modal-ios";

        // Header with close and save buttons
        const header = document.createElement("div");
        header.className = "ncm-ios-header";

        const closeBtn = document.createElement("button");
        closeBtn.className = "ncm-ios-header-btn";
        closeBtn.innerHTML = this.icon("close");
        closeBtn.addEventListener("click", () => this.closeAllModals());

        const title = document.createElement("span");
        title.className = "ncm-ios-header-title";
        title.id = "ncm-edit-title";
        title.textContent = "Neu";

        const saveBtn = document.createElement("button");
        saveBtn.className = "ncm-ios-header-btn ncm-ios-save";
        saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20,6 9,17 4,12"/></svg>';
        saveBtn.addEventListener("click", () => this.saveEvent());

        header.append(closeBtn, title, saveBtn);

        const content = document.createElement("div");
        content.className = "ncm-ios-content";

        // Section 1: Calendar selector
        const sec1 = document.createElement("div");
        sec1.className = "ncm-ios-section";
        const calRow = document.createElement("div");
        calRow.className = "ncm-ios-cal-row";
        calRow.id = "ncm-cal-sel";
        sec1.appendChild(calRow);

        // Section 2: Title and location inputs
        const sec2 = document.createElement("div");
        sec2.className = "ncm-ios-section";

        const titleRow = document.createElement("div");
        titleRow.className = "ncm-ios-row";
        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.id = "ncm-edit-title-input";
        titleInput.className = "ncm-ios-input";
        titleInput.placeholder = "Titel";
        titleInput.spellcheck = false;
        titleInput.autocomplete = "off";
        titleInput.autocorrect = "off";
        titleInput.autocapitalize = "off";
        titleInput.addEventListener("focus", () => {
            this.setActiveInput(titleInput);
            this.showKeyboard("text");
            this.updateSuggestions();
        });
        titleInput.addEventListener("input", () => this.updateSuggestions());
        titleRow.appendChild(titleInput);

        const locRow = document.createElement("div");
        locRow.className = "ncm-ios-row";
        const locInput = document.createElement("input");
        locInput.type = "text";
        locInput.id = "ncm-edit-loc";
        locInput.className = "ncm-ios-input ncm-ios-input-sm";
        locInput.placeholder = "Standort";
        locInput.spellcheck = false;
        locInput.autocomplete = "off";
        locInput.autocorrect = "off";
        locInput.autocapitalize = "off";
        locInput.addEventListener("focus", () => {
            this.setActiveInput(locInput);
            this.showKeyboard("text");
            this.updateSuggestions();
        });
        locInput.addEventListener("input", () => this.updateSuggestions());
        locRow.appendChild(locInput);

        sec2.append(titleRow, locRow);

        // Section 3: Date, time, and recurrence
        const sec3 = document.createElement("div");
        sec3.className = "ncm-ios-section";

        const allDayRow = document.createElement("div");
        allDayRow.className = "ncm-ios-toggle-row";
        const allDayLabel = document.createElement("span");
        allDayLabel.className = "ncm-ios-toggle-label";
        allDayLabel.textContent = "Ganztägig";
        const allDaySwitch = document.createElement("div");
        allDaySwitch.className = "ncm-ios-switch";
        allDaySwitch.id = "ncm-allday-switch";
        allDaySwitch.addEventListener("click", () => {
            allDaySwitch.classList.toggle("active");
            this.updateDateTimeInputs();
        });
        allDayRow.append(allDayLabel, allDaySwitch);

        // Hidden checkbox for backward compatibility
        const allDayCheck = document.createElement("input");
        allDayCheck.type = "checkbox";
        allDayCheck.id = "ncm-edit-allday";
        allDayCheck.style.display = "none";

        const startRow = document.createElement("div");
        startRow.className = "ncm-ios-datetime-row";
        const startLabel = document.createElement("span");
        startLabel.className = "ncm-ios-datetime-label";
        startLabel.textContent = "Beginn";
        const startValues = document.createElement("div");
        startValues.className = "ncm-ios-datetime-values";
        const startDateBtn = document.createElement("button");
        startDateBtn.type = "button";
        startDateBtn.id = "ncm-start-date-btn";
        startDateBtn.className = "ncm-ios-datetime-btn";
        startDateBtn.addEventListener("click", () => this.openCalendarPicker("start"));
        const startTimeInput = document.createElement("input");
        startTimeInput.type = "text";
        startTimeInput.id = "ncm-start-time-input";
        startTimeInput.className = "ncm-ios-time-input";
        startTimeInput.placeholder = "HH:MM";
        startTimeInput.maxLength = 5;
        startTimeInput.spellcheck = false;
        startTimeInput.inputMode = "numeric";
        startTimeInput.addEventListener("focus", () => {
            this.setActiveInput(startTimeInput);
            this.showKeyboard("time");
            this.timeInputFirstKey = true;
        });
        startTimeInput.addEventListener("blur", () => this.validateTimeInput("start"));
        // Allow only digits, colon, and navigation keys
        startTimeInput.addEventListener("keydown", (e) => {
            const allowed = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab"];
            if (!allowed.includes(e.key)) {
                e.preventDefault();
            }
        });
        startValues.append(startDateBtn, startTimeInput);
        startRow.append(startLabel, startValues);

        const endRow = document.createElement("div");
        endRow.className = "ncm-ios-datetime-row";
        const endLabel = document.createElement("span");
        endLabel.className = "ncm-ios-datetime-label";
        endLabel.textContent = "Ende";
        const endValues = document.createElement("div");
        endValues.className = "ncm-ios-datetime-values";
        const endDateBtn = document.createElement("button");
        endDateBtn.type = "button";
        endDateBtn.id = "ncm-end-date-btn";
        endDateBtn.className = "ncm-ios-datetime-btn";
        endDateBtn.addEventListener("click", () => this.openCalendarPicker("end"));
        const endTimeInput = document.createElement("input");
        endTimeInput.type = "text";
        endTimeInput.id = "ncm-end-time-input";
        endTimeInput.className = "ncm-ios-time-input";
        endTimeInput.placeholder = "HH:MM";
        endTimeInput.maxLength = 5;
        endTimeInput.spellcheck = false;
        endTimeInput.inputMode = "numeric";
        endTimeInput.addEventListener("focus", () => {
            this.setActiveInput(endTimeInput);
            this.showKeyboard("time");
            this.timeInputFirstKey = true;
        });
        endTimeInput.addEventListener("blur", () => this.validateTimeInput("end"));
        endTimeInput.addEventListener("keydown", (e) => {
            const allowed = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab"];
            if (!allowed.includes(e.key)) {
                e.preventDefault();
            }
        });
        endValues.append(endDateBtn, endTimeInput);
        endRow.append(endLabel, endValues);

        const repeatRow = document.createElement("div");
        repeatRow.className = "ncm-ios-toggle-row";
        const repeatLabel = document.createElement("span");
        repeatLabel.className = "ncm-ios-toggle-label";
        repeatLabel.textContent = "Wiederholen";

        const repeatSelect = document.createElement("div");
        repeatSelect.className = "ncm-repeat-select";
        repeatSelect.id = "ncm-repeat-select";

        const repeatOptions = [
            { value: "", label: "Nie" },
            { value: "DAILY", label: "Täglich" },
            { value: "WEEKLY", label: "Wöchentlich" },
            { value: "MONTHLY", label: "Monatlich" },
            { value: "YEARLY", label: "Jährlich" }
        ];

        repeatOptions.forEach(opt => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ncm-repeat-btn" + (opt.value === "" ? " active" : "");
            btn.textContent = opt.label;
            btn.dataset.value = opt.value;
            btn.addEventListener("click", () => {
                repeatSelect.querySelectorAll(".ncm-repeat-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            });
            repeatSelect.appendChild(btn);
        });

        repeatRow.append(repeatLabel, repeatSelect);

        sec3.append(allDayRow, allDayCheck, startRow, endRow, repeatRow);

        // Section 4: Notes textarea
        const sec4 = document.createElement("div");
        sec4.className = "ncm-ios-section";
        const notesRow = document.createElement("div");
        notesRow.className = "ncm-ios-row";
        const notesInput = document.createElement("textarea");
        notesInput.id = "ncm-edit-notes";
        notesInput.className = "ncm-ios-input";
        notesInput.placeholder = "Notizen";
        notesInput.rows = 2;
        notesInput.style.resize = "none";
        notesInput.spellcheck = false;
        notesInput.addEventListener("focus", () => {
            this.setActiveInput(notesInput);
            this.showKeyboard("text");
        });
        notesRow.appendChild(notesInput);
        sec4.appendChild(notesRow);

        // Hidden attendees field for future use
        const attInput = document.createElement("input");
        attInput.type = "hidden";
        attInput.id = "ncm-edit-att";
        attInput.value = "";

        content.append(sec1, sec2, sec3, sec4, attInput);

        const suggestBar = document.createElement("div");
        suggestBar.className = "ncm-suggestions-bar";
        suggestBar.id = "ncm-suggestions";

        const kbArea = document.createElement("div");
        kbArea.className = "ncm-ios-keyboard";
        kbArea.id = "ncm-keyboard-area";
        kbArea.appendChild(this.createKeyboard());

        c.append(header, content, suggestBar, kbArea);
        m.appendChild(c);
        return m;
    },

    // Syncs the iOS switch state to the hidden checkbox and updates date/time fields.
    updateDateTimeInputs: function () {
        const allDaySwitch = document.getElementById("ncm-allday-switch");
        const allDayCheckbox = document.getElementById("ncm-edit-allday");
        const allDay = allDaySwitch?.classList.contains("active") || false;

        if (allDayCheckbox) {
            allDayCheckbox.checked = allDay;
        }

        const startDateBtn = document.getElementById("ncm-start-date-btn");
        const startTimeInput = document.getElementById("ncm-start-time-input");
        const endDateBtn = document.getElementById("ncm-end-date-btn");
        const endTimeInput = document.getElementById("ncm-end-time-input");

        if (!startDateBtn || !endDateBtn) return;

        const formatDate = (d) => {
            const day = String(d.getDate()).padStart(2, "0");
            const month = String(d.getMonth() + 1).padStart(2, "0");
            const year = d.getFullYear();
            return `${day}.${month}.${year}`;
        };

        const formatTime = (d) => {
            return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        };

        startDateBtn.textContent = formatDate(this.editStartDate);
        endDateBtn.textContent = formatDate(this.editEndDate);

        if (allDay) {
            if (startTimeInput) startTimeInput.style.display = "none";
            if (endTimeInput) endTimeInput.style.display = "none";
        } else {
            if (startTimeInput) {
                startTimeInput.style.display = "";
                startTimeInput.value = formatTime(this.editStartDate);
            }
            if (endTimeInput) {
                endTimeInput.style.display = "";
                endTimeInput.value = formatTime(this.editEndDate);
            }
        }
    },

    // Validates and normalises a time input field (HH:MM or HH format).
    validateTimeInput: function (type) {
        const input = document.getElementById(`ncm-${type}-time-input`);
        if (!input) return;

        let value = input.value.trim();
        if (!value) return;

        let hour, minute;

        let match = value.match(/^(\d{1,2}):(\d{1,2})$/);
        if (match) {
            hour = parseInt(match[1], 10);
            minute = parseInt(match[2], 10);
        } else {
            // Accept bare hour number, e.g. "17" → "17:00"
            match = value.match(/^(\d{1,2})$/);
            if (match) {
                hour = parseInt(match[1], 10);
                minute = 0;
            } else {
                // Reset to current value on invalid input
                const date = type === "start" ? this.editStartDate : this.editEndDate;
                input.value = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                return;
            }
        }

        if (hour > 23) hour = 23;
        if (hour < 0) hour = 0;
        if (minute > 59) minute = 59;
        if (minute < 0) minute = 0;

        const date = type === "start" ? this.editStartDate : this.editEndDate;
        date.setHours(hour, minute, 0, 0);

        input.value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

        // Auto-advance end if it would be before start
        if (this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
            this.updateDateTimeInputs();
        }

        this.showKeyboard("text");
    },

    openCalendarPicker: function (type) {
        this.calendarPickerType = type;
        this.calendarPickerDate = type === "start" ? new Date(this.editStartDate) : new Date(this.editEndDate);
        this.renderCalendarPickerModal();
        document.getElementById("ncm-calpicker-modal").classList.remove("ncm-hidden");
    },

    // Renders (or re-renders) the inline calendar picker modal.
    renderCalendarPickerModal: function () {
        let modal = document.getElementById("ncm-calpicker-modal");
        if (!modal) {
            modal = document.createElement("div");
            modal.className = "ncm-modal ncm-hidden";
            modal.id = "ncm-calpicker-modal";
            document.body.appendChild(modal);
        }

        const d = this.calendarPickerDate;
        const y = d.getFullYear();
        const m = d.getMonth();
        const months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

        modal.innerHTML = `
            <div class="ncm-modal-content ncm-calpicker-content">
                <div class="ncm-calpicker-header">
                    <button class="ncm-calpicker-nav" id="ncm-calpicker-prev">&lt;</button>
                    <span class="ncm-calpicker-title">${months[m]} ${y}</span>
                    <button class="ncm-calpicker-nav" id="ncm-calpicker-next">&gt;</button>
                </div>
                <div class="ncm-calpicker-weekdays">
                    <span>MO</span><span>DI</span><span>MI</span><span>DO</span><span>FR</span><span>SA</span><span>SO</span>
                </div>
                <div class="ncm-calpicker-grid" id="ncm-calpicker-grid"></div>
                <button class="ncm-btn ncm-btn-primary ncm-btn-full ncm-calpicker-close">Abbrechen</button>
            </div>
        `;

        const grid = modal.querySelector("#ncm-calpicker-grid");
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        let startWeekday = firstDay.getDay() || 7;

        // Fill leading empty cells for days before the 1st
        for (let i = 1; i < startWeekday; i++) {
            const empty = document.createElement("div");
            empty.className = "ncm-calpicker-day ncm-calpicker-empty";
            grid.appendChild(empty);
        }

        const selectedDate = this.calendarPickerType === "start" ? this.editStartDate : this.editEndDate;
        const today = new Date();

        for (let day = 1; day <= lastDay.getDate(); day++) {
            const btn = document.createElement("button");
            btn.className = "ncm-calpicker-day";
            btn.textContent = day;

            const thisDate = new Date(y, m, day);

            if (thisDate.toDateString() === today.toDateString()) {
                btn.classList.add("ncm-calpicker-today");
            }

            if (thisDate.toDateString() === selectedDate.toDateString()) {
                btn.classList.add("ncm-calpicker-selected");
            }

            btn.addEventListener("click", () => this.selectCalendarPickerDate(y, m, day));
            grid.appendChild(btn);
        }

        modal.querySelector("#ncm-calpicker-prev").addEventListener("click", () => {
            this.calendarPickerDate.setMonth(this.calendarPickerDate.getMonth() - 1);
            this.renderCalendarPickerModal();
        });

        modal.querySelector("#ncm-calpicker-next").addEventListener("click", () => {
            this.calendarPickerDate.setMonth(this.calendarPickerDate.getMonth() + 1);
            this.renderCalendarPickerModal();
        });

        modal.querySelector(".ncm-calpicker-close").addEventListener("click", () => {
            modal.classList.add("ncm-hidden");
        });
    },

    selectCalendarPickerDate: function (y, m, day) {
        const date = this.calendarPickerType === "start" ? this.editStartDate : this.editEndDate;
        date.setFullYear(y);
        date.setMonth(m);
        date.setDate(day);

        // Ensure end is never before start
        if (this.editEndDate < this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate);
            this.editEndDate.setHours(this.editStartDate.getHours() + 1);
        }

        this.updateDateTimeInputs();
        document.getElementById("ncm-calpicker-modal").classList.add("ncm-hidden");
    },

    // Opens the edit modal, pre-filling fields when editing an existing event.
    openEditModal: function (ev = null) {
        this.editingEvent = ev;
        const tit = document.getElementById("ncm-edit-title");
        const titIn = document.getElementById("ncm-edit-title-input");
        const allDayCheckbox = document.getElementById("ncm-edit-allday");
        const allDaySwitch = document.getElementById("ncm-allday-switch");
        const loc = document.getElementById("ncm-edit-loc");
        const notes = document.getElementById("ncm-edit-notes");

        if (ev) {
            tit.textContent = "Bearbeiten";
            titIn.value = ev.title;
            if (allDayCheckbox) allDayCheckbox.checked = ev.isAllDay || false;
            if (allDaySwitch) allDaySwitch.classList.toggle("active", ev.isAllDay || false);
            loc.value = ev.location || "";
            notes.value = ev.description || "";
            this.editStartDate = new Date(ev.start);
            this.editEndDate = new Date(ev.end);
            this.selectedCalendar = this.config.calendars.find(c => c.name === ev.calendarName) || this.config.calendars[0];
        } else {
            tit.textContent = "Neu";
            titIn.value = "";
            if (allDayCheckbox) allDayCheckbox.checked = false;
            if (allDaySwitch) allDaySwitch.classList.remove("active");
            loc.value = "";
            notes.value = "";
            const now = new Date();
            now.setMinutes(0, 0, 0);
            now.setHours(now.getHours() + 1);
            this.editStartDate = now;
            this.editEndDate = new Date(now.getTime() + 3600000);
            this.selectedCalendar = this.config.calendars[0];
        }

        // Set recurrence selector to match the event's RRULE (or "None")
        const repeatSel = document.getElementById("ncm-repeat-select");
        if (repeatSel) {
            repeatSel.querySelectorAll(".ncm-repeat-btn").forEach(b => b.classList.remove("active"));

            if (ev && ev.isRecurring && ev.rrule) {
                const freq = this.getRecurrenceFreq(ev.rrule);
                const activeBtn = repeatSel.querySelector(`.ncm-repeat-btn[data-value="${freq}"]`);
                if (activeBtn) {
                    activeBtn.classList.add("active");
                } else {
                    const nieBtn = repeatSel.querySelector('.ncm-repeat-btn[data-value=""]');
                    if (nieBtn) nieBtn.classList.add("active");
                }
            } else {
                const nieBtn = repeatSel.querySelector('.ncm-repeat-btn[data-value=""]');
                if (nieBtn) nieBtn.classList.add("active");
            }
        }

        this.renderCalSelector();
        this.updateDateTimeInputs();
        document.getElementById("ncm-edit-modal").classList.remove("ncm-hidden");
        titIn.focus();
    },

    // Opens the edit modal pre-set to a specific date (from day modal).
    openEditModalForDate: function (date) {
        this.editingEvent = null;
        const start = new Date(date);
        start.setHours(10, 0, 0, 0);
        this.editStartDate = start;
        this.editEndDate = new Date(start.getTime() + 3600000);
        this.selectedCalendar = this.config.calendars[0];

        document.getElementById("ncm-edit-title").textContent = "Neu";
        document.getElementById("ncm-edit-title-input").value = "";
        const allDayCheckbox = document.getElementById("ncm-edit-allday");
        const allDaySwitch = document.getElementById("ncm-allday-switch");
        if (allDayCheckbox) allDayCheckbox.checked = false;
        if (allDaySwitch) allDaySwitch.classList.remove("active");
        document.getElementById("ncm-edit-loc").value = "";
        document.getElementById("ncm-edit-notes").value = "";

        const repeatSel2 = document.getElementById("ncm-repeat-select");
        if (repeatSel2) {
            repeatSel2.querySelectorAll(".ncm-repeat-btn").forEach(b => b.classList.remove("active"));
            const nieBtn2 = repeatSel2.querySelector('.ncm-repeat-btn[data-value=""]');
            if (nieBtn2) nieBtn2.classList.add("active");
        }

        this.renderCalSelector();
        this.updateDateTimeInputs();
        document.getElementById("ncm-edit-modal").classList.remove("ncm-hidden");
    },

    // Re-renders the calendar selection buttons, highlighting the currently selected one.
    renderCalSelector: function () {
        const cont = document.getElementById("ncm-cal-sel");
        cont.innerHTML = "";
        this.config.calendars.forEach(cal => {
            const btn = document.createElement("button");
            btn.className = "ncm-ios-cal-btn" + (this.selectedCalendar?.name === cal.name ? " selected" : "");
            btn.style.backgroundColor = cal.color;
            btn.textContent = cal.name;
            btn.addEventListener("mousedown", e => e.preventDefault());
            btn.addEventListener("click", () => {
                this.selectedCalendar = cal;
                this.renderCalSelector();
                this.updateSuggestions();
                if (this.activeInputField) {
                    this.activeInputField.focus();
                }
            });
            cont.appendChild(btn);
        });
    },

    // Re-renders the start/end scroll wheels inside the date container.
    updateWheels: function () {
        const cont = document.getElementById("ncm-date-container");
        const allDay = document.getElementById("ncm-edit-allday").checked;
        cont.innerHTML = "";

        const startW = document.createElement("div");
        startW.className = "ncm-wheel-box";
        startW.innerHTML = '<label class="ncm-lbl">Start</label>';
        startW.appendChild(this.createWheel("start", allDay));
        cont.appendChild(startW);

        const endW = document.createElement("div");
        endW.className = "ncm-wheel-box";
        endW.innerHTML = '<label class="ncm-lbl">Ende</label>';
        endW.appendChild(this.createWheel("end", allDay));
        cont.appendChild(endW);
    },

    // Builds a date (and optionally time) scroll-wheel row for start or end.
    createWheel: function (type, allDay) {
        const w = document.createElement("div");
        w.className = "ncm-wheel-inline";

        const d = type === "start" ? this.editStartDate : this.editEndDate;

        const dayWheel = this.createInlineScrollWheel(type, "day", 31, d.getDate(), 1);
        w.appendChild(dayWheel);

        const dot1 = document.createElement("span");
        dot1.className = "ncm-wheel-dot";
        dot1.textContent = ".";
        w.appendChild(dot1);

        const monthWheel = this.createInlineScrollWheel(type, "month", 12, d.getMonth() + 1, 1);
        w.appendChild(monthWheel);

        const dot2 = document.createElement("span");
        dot2.className = "ncm-wheel-dot";
        dot2.textContent = ".";
        w.appendChild(dot2);

        const yearWheel = this.createYearScrollWheel(type, d.getFullYear());
        w.appendChild(yearWheel);

        if (!allDay) {
            const space = document.createElement("span");
            space.className = "ncm-wheel-space";
            w.appendChild(space);

            const hourWheel = this.createInlineScrollWheel(type, "hour", 24, d.getHours(), 0);
            w.appendChild(hourWheel);

            const colon = document.createElement("span");
            colon.className = "ncm-wheel-colon";
            colon.textContent = ":";
            w.appendChild(colon);

            const minWheel = this.createInlineScrollWheel(type, "minute", 60, d.getMinutes(), 0);
            w.appendChild(minWheel);
        }

        return w;
    },

    // Creates a scrollable column for a numeric date/time unit.
    createInlineScrollWheel: function (type, unit, max, current, startFrom) {
        const container = document.createElement("div");
        container.className = "ncm-inline-scroll";

        const list = document.createElement("div");
        list.className = "ncm-inline-list";
        list.dataset.type = type;
        list.dataset.unit = unit;

        for (let i = startFrom; i < max + startFrom; i++) {
            const item = document.createElement("div");
            item.className = "ncm-inline-item";
            if (i === current) item.classList.add("ncm-inline-sel");
            item.textContent = String(i).padStart(2, "0");
            item.dataset.value = i;
            item.addEventListener("click", () => this.selectInlineValue(type, unit, i));
            list.appendChild(item);
        }

        container.appendChild(list);

        // Scroll to the selected item after render
        setTimeout(() => {
            const sel = list.querySelector(".ncm-inline-sel");
            if (sel) list.scrollTop = sel.offsetTop - list.offsetHeight / 2 + sel.offsetHeight / 2;
        }, 10);

        return container;
    },

    // Creates a year scroll wheel spanning from currentYear-2 to currentYear+5.
    createYearScrollWheel: function (type, currentYear) {
        const container = document.createElement("div");
        container.className = "ncm-inline-scroll ncm-inline-year";

        const list = document.createElement("div");
        list.className = "ncm-inline-list";
        list.dataset.type = type;
        list.dataset.unit = "year";

        for (let y = currentYear - 2; y <= currentYear + 5; y++) {
            const item = document.createElement("div");
            item.className = "ncm-inline-item";
            if (y === currentYear) item.classList.add("ncm-inline-sel");
            item.textContent = y;
            item.dataset.value = y;
            item.addEventListener("click", () => this.selectInlineValue(type, "year", y));
            list.appendChild(item);
        }

        container.appendChild(list);

        setTimeout(() => {
            const sel = list.querySelector(".ncm-inline-sel");
            if (sel) list.scrollTop = sel.offsetTop - list.offsetHeight / 2 + sel.offsetHeight / 2;
        }, 10);

        return container;
    },

    // Updates the date object when a scroll-wheel item is clicked and auto-adjusts if needed.
    selectInlineValue: function (type, unit, value) {
        const d = type === "start" ? this.editStartDate : this.editEndDate;

        if (unit === "day") d.setDate(value);
        else if (unit === "month") d.setMonth(value - 1);
        else if (unit === "year") d.setFullYear(value);
        else if (unit === "hour") d.setHours(value);
        else if (unit === "minute") d.setMinutes(value);

        if (type === "start" && this.editStartDate >= this.editEndDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }
        if (type === "end" && this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }

        this.updateWheels();
    },

    // Creates an up/down stepper column for a numeric date unit.
    makeCol: function (type, unit, val, step = 1) {
        const col = document.createElement("div");
        col.className = "ncm-col";

        const up = document.createElement("button");
        up.className = "ncm-wheel-btn";
        up.innerHTML = this.icon("up");
        up.addEventListener("mousedown", e => e.preventDefault());
        up.addEventListener("click", () => this.stepWheel(type, unit, step));

        const v = document.createElement("span");
        v.className = "ncm-val";
        v.textContent = val;

        const dn = document.createElement("button");
        dn.className = "ncm-wheel-btn";
        dn.innerHTML = this.icon("down");
        dn.addEventListener("mousedown", e => e.preventDefault());
        dn.addEventListener("click", () => this.stepWheel(type, unit, -step));

        col.append(up, v, dn);
        return col;
    },

    // Creates an up/down stepper column that displays a label (e.g. month name).
    makeColLabel: function (type, unit, val) {
        const col = document.createElement("div");
        col.className = "ncm-col ncm-col-wide";

        const up = document.createElement("button");
        up.className = "ncm-wheel-btn";
        up.innerHTML = this.icon("up");
        up.addEventListener("mousedown", e => e.preventDefault());
        up.addEventListener("click", () => this.stepWheel(type, unit, 1));

        const v = document.createElement("span");
        v.className = "ncm-val";
        v.textContent = val;

        const dn = document.createElement("button");
        dn.className = "ncm-wheel-btn";
        dn.innerHTML = this.icon("down");
        dn.addEventListener("mousedown", e => e.preventDefault());
        dn.addEventListener("click", () => this.stepWheel(type, unit, -1));

        col.append(up, v, dn);
        return col;
    },

    // Increments/decrements a date unit and auto-adjusts end if it precedes start.
    stepWheel: function (type, unit, amt) {
        const d = type === "start" ? this.editStartDate : this.editEndDate;
        if (unit === "day") d.setDate(d.getDate() + amt);
        else if (unit === "month") d.setMonth(d.getMonth() + amt);
        else if (unit === "year") d.setFullYear(d.getFullYear() + amt);
        else if (unit === "hour") d.setHours(d.getHours() + amt);
        else if (unit === "minute") d.setMinutes(d.getMinutes() + amt);

        if (type === "start" && this.editStartDate >= this.editEndDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }
        if (type === "end" && this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }

        this.updateWheels();
    },

    // Collects form values and sends CREATE or UPDATE notification to the helper.
    saveEvent: function () {
        const title = document.getElementById("ncm-edit-title-input").value.trim();
        if (!title) { this.showAlert("Bitte Titel eingeben"); return; }

        this.validateTimeInput("start");
        this.validateTimeInput("end");

        if (this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }

        const ev = {
            title: title,
            start: this.editStartDate.toISOString(),
            end: this.editEndDate.toISOString(),
            isAllDay: document.getElementById("ncm-edit-allday").checked,
            location: document.getElementById("ncm-edit-loc").value.trim(),
            attendees: document.getElementById("ncm-edit-att")?.value?.split(",").map(s => s.trim()).filter(s => s) || [],
            description: document.getElementById("ncm-edit-notes").value.trim(),
            recurrence: document.querySelector("#ncm-repeat-select .ncm-repeat-btn.active")?.dataset?.value || "",
        };

        if (this.editingEvent) {
            const calendarChanged = this.selectedCalendar.name !== this.editingEvent.calendarName;

            if (calendarChanged) {
                // Moving to a different calendar: delete old, create new
                this.showLoading("Termin wird verschoben…");
                this.sendSocketNotification("DELETE_EVENT", {
                    href: this.editingEvent.href,
                    user: this.editingEvent.calendarUser,
                    pass: this.editingEvent.calendarPass,
                });
                this.sendSocketNotification("CREATE_EVENT", {
                    calendar: { url: this.selectedCalendar.url, user: this.selectedCalendar.user, pass: this.selectedCalendar.pass },
                    event: ev,
                });
            } else {
                // Same calendar: update via PUT
                this.showLoading("Termin wird gespeichert…");
                ev.lastModified = new Date();
                this.sendSocketNotification("UPDATE_EVENT", {
                    calendar: {
                        url: this.selectedCalendar.url,
                        user: this.selectedCalendar.user,
                        pass: this.selectedCalendar.pass
                    },
                    event: ev,
                    existingHref: this.editingEvent.href,
                    existingUid: this.editingEvent.uid
                });
            }
        } else {
            this.showLoading("Termin wird erstellt…");
            this.sendSocketNotification("CREATE_EVENT", {
                calendar: { url: this.selectedCalendar.url, user: this.selectedCalendar.user, pass: this.selectedCalendar.pass },
                event: ev,
            });
        }
    },

    // Per-calendar autocomplete suggestions for the title field.
    calendarSuggestions: {
        "Familie": ["Besuch", "Ferien", "Geburtstag"],
        "Papa": ["Geschäftsessen", "Arzt", "Meeting"],
        "Noa": ["Match", "Zahnarzt", "Training"],
        "Mattia": ["Match", "Zahnarzt", "Training"],
        "Mama": ["Tagdienst", "Nachtdienst", "Spätdienst"],
        "Amelie": ["Reiten", "Tanzen", "Training"]
    },

    // Swiss city list used for location autocomplete suggestions.
    locationSuggestions: [
        "Rubigen", "Münsingen", "Worb", "Belp", "Konolfingen", "Grosshöchstetten", "Zollikofen",
        "Bern", "Zürich", "Basel", "Genf", "Lausanne", "Winterthur", "Luzern", "St. Gallen",
        "Lugano", "Biel", "Thun", "Köniz", "La Chaux-de-Fonds", "Fribourg", "Schaffhausen",
        "Chur", "Vernier", "Neuchâtel", "Uster", "Sion", "Lancy", "Emmen", "Yverdon-les-Bains",
        "Zug", "Kriens", "Rapperswil-Jona", "Dübendorf", "Dietikon", "Montreux", "Frauenfeld",
        "Wetzikon", "Baar", "Meyrin", "Wädenswil", "Carouge", "Allschwil", "Renens", "Aarau",
        "Baden", "Burgdorf", "Solothurn", "Olten", "Langenthal", "Interlaken", "Davos", "Locarno"
    ],

    keyboardMode: "text",
    timeInputFirstKey: false,

    // Switches between text and numeric time keyboard layouts.
    showKeyboard: function (type) {
        const kbArea = document.getElementById("ncm-keyboard-area");
        const suggestBar = document.getElementById("ncm-suggestions");
        if (!kbArea) return;

        this.keyboardMode = type;
        kbArea.innerHTML = "";

        if (type === "time") {
            kbArea.appendChild(this.createTimeKeyboard());
            if (suggestBar) suggestBar.style.display = "none";
        } else {
            kbArea.appendChild(this.createKeyboard());
            if (suggestBar) suggestBar.style.display = "flex";
        }
    },

    // Updates the autocomplete suggestion bar based on the active input field and current text.
    updateSuggestions: function () {
        const suggestBar = document.getElementById("ncm-suggestions");
        if (!suggestBar) return;

        const titleInput = document.getElementById("ncm-edit-title-input");
        const locInput = document.getElementById("ncm-edit-loc");
        const activeEl = this.activeInputField;

        let suggestions = [];
        const fullText = (activeEl?.value || "");

        // Match against the last typed word only
        const words = fullText.split(" ");
        const lastWord = words[words.length - 1].toLowerCase();

        const generalWords = [
            "Hallo", "Heute", "Morgen", "Abend", "Arbeit", "Schule", "Sport",
            "Essen", "Einkaufen", "Arzt", "Zahnarzt", "Meeting", "Termin",
            "Geburtstag", "Feier", "Party", "Hochzeit", "Urlaub", "Ferien",
            "Besuch", "Familie", "Freunde", "Kino", "Theater", "Konzert",
            "Training", "Match", "Spiel", "Fussball", "Tennis", "Schwimmen",
            "Mittagessen", "Abendessen", "Frühstück", "Kaffee", "Telefon",
            "Anruf", "Video", "Online", "Besprechung", "Sitzung", "Konferenz",
            "Putzen", "Waschen", "Kochen", "Backen", "Garten", "Auto",
            "Reparatur", "Service", "Lieferung", "Paket", "Post", "Bank",
            "Zahlung", "Rechnung", "Vertrag", "Unterschrift", "Dokument"
        ];

        if (activeEl === titleInput) {
            const calName = this.selectedCalendar?.name || "";
            const baseSuggestions = this.calendarSuggestions[calName] || ["Termin", "Meeting", "Besprechung"];

            if (lastWord.length > 0) {
                // Calendar-specific suggestions first, then general words
                suggestions = baseSuggestions.filter(s => s.toLowerCase().startsWith(lastWord));

                generalWords.forEach(w => {
                    if (w.toLowerCase().startsWith(lastWord) && !suggestions.includes(w)) {
                        suggestions.push(w);
                    }
                });

                // Fall back to partial matches if fewer than 3 results
                if (suggestions.length < 3) {
                    generalWords.forEach(w => {
                        if (w.toLowerCase().includes(lastWord) && !suggestions.includes(w)) {
                            suggestions.push(w);
                        }
                    });
                }
            } else {
                suggestions = baseSuggestions.slice(0, 3);
            }
        } else if (activeEl === locInput) {
            if (lastWord.length > 0) {
                suggestions = this.locationSuggestions.filter(s => s.toLowerCase().startsWith(lastWord));
                if (suggestions.length < 3) {
                    this.locationSuggestions.forEach(s => {
                        if (s.toLowerCase().includes(lastWord) && !suggestions.includes(s)) {
                            suggestions.push(s);
                        }
                    });
                }
            } else {
                suggestions = this.locationSuggestions.slice(0, 3);
            }
        }

        suggestions = suggestions.slice(0, 3);

        suggestBar.innerHTML = "";

        suggestions.forEach((s, idx) => {
            const btn = document.createElement("button");
            btn.className = "ncm-suggestion-btn";
            btn.textContent = s;
            btn.addEventListener("mousedown", e => e.preventDefault());
            btn.addEventListener("click", () => this.applySuggestion(s));
            suggestBar.appendChild(btn);

            if (idx < suggestions.length - 1) {
                const divider = document.createElement("div");
                divider.className = "ncm-suggestion-divider";
                suggestBar.appendChild(divider);
            }
        });
    },

    // Replaces the last word in the active input with the selected suggestion.
    applySuggestion: function (text) {
        if (!this.activeInputField) return;
        const el = this.activeInputField;

        const fullText = el.value;
        const words = fullText.split(" ");

        words[words.length - 1] = text;

        const newValue = words.join(" ") + " ";
        el.value = newValue;

        // Keep simple-keyboard in sync with the new value
        if (this.keyboard) {
            this.keyboard.setInput(newValue);
            if (this.keyboard.getInput() !== newValue) {
                this.keyboard.setInput(newValue);
            }
        }

        const len = el.value.length;
        el.selectionStart = len;
        el.selectionEnd = len;

        el.focus();
        this.updateSuggestions();
    },

    // Initialises the simple-keyboard container and retries until the library is loaded.
    createKeyboard: function () {
        const self = this;
        const kb = document.createElement("div");
        kb.className = "simple-keyboard-container";
        kb.id = "ncm-kb-main";

        let moves = 0;
        const maxMoves = 10;

        const tryInit = () => {
            const kbAvailable = (typeof SimpleKeyboard !== "undefined");
            if (kbAvailable && document.querySelector(".simple-keyboard-container")) {
                self.initSimpleKeyboard();
            } else {
                moves++;
                if (moves < maxMoves) {
                    setTimeout(tryInit, 200);
                } else {
                    console.error("MMM-Nextcloud-Calendar: SimpleKeyboard library not loaded after timeout.");
                    kb.innerHTML = "<div style='color:red; text-align:center; padding:20px;'>Fehler: Tastatur-Bibliothek nicht geladen.<br>Bitte prüfen: <code>npm install simple-keyboard</code> im Modul-Ordner ausgeführt?</div>";
                }
            }
        };

        setTimeout(tryInit, 200);

        return kb;
    },

    // Resolves the SimpleKeyboard class and initialises the QWERTZ on-screen keyboard.
    initSimpleKeyboard: function () {
        const self = this;

        // SimpleKeyboard must be used instead of the native Keyboard Web API
        let KeyboardClass = null;

        if (typeof SimpleKeyboard !== "undefined") {
            KeyboardClass = SimpleKeyboard;
            if (SimpleKeyboard.default) {
                KeyboardClass = SimpleKeyboard.default;
            }
        }

        if (!KeyboardClass) {
            console.error("MMM-Nextcloud-Calendar: SimpleKeyboard class could not be resolved.");
            console.log("Debug: typeof SimpleKeyboard is", typeof SimpleKeyboard);

            const kb = document.getElementById("ncm-kb-main");
            if (kb) {
                kb.innerHTML = "<div style='color:red; text-align:center;'>Fehler: Keyboard Klasse nicht gefunden.<br>Variable 'SimpleKeyboard' ist undefined.</div>";
            }
            return;
        }

        if (this.keyboard) {
            this.keyboard.destroy();
        }

        try {
            this.keyboard = new KeyboardClass(".simple-keyboard-container", {
                onChange: input => self.onKeyboardChange(input),
                onKeyPress: button => self.onKeyPress(button),
                layout: {
                    default: [
                        "q w e r t z u i o p ü",
                        "a s d f g h j k l ö ä",
                        "{shift} y x c v b n m {bksp}",
                        "{numbers} {space} {enter}"
                    ],
                    shift: [
                        "Q W E R T Z U I O P Ü",
                        "A S D F G H J K L Ö Ä",
                        "{shift} Y X C V B N M {bksp}",
                        "{numbers} {space} {enter}"
                    ],
                    numbers: [
                        "1 2 3 4 5 6 7 8 9 0",
                        "- / : ; ( ) € & @ \"",
                        "{symbols} . , ? ! ' {bksp}",
                        "{abc} {space} {enter}"
                    ],
                    symbols: [
                        "[ ] { } # % ^ * + =",
                        "_ \\ | ~ < > € £ ¥ •",
                        "{numbers} . , ? ! ' {bksp}",
                        "{abc} {space} {enter}"
                    ]
                },
                display: {
                    "{bksp}": "⌫",
                    "{enter}": "↵",
                    "{shift}": "⇧",
                    "{space}": "Leertaste",
                    "{numbers}": "123",
                    "{abc}": "ABC",
                    "{symbols}": "#+="
                },
                buttonTheme: [
                    {
                        class: "ncm-sk-special",
                        buttons: "{bksp} {enter} {shift} {numbers} {abc} {symbols}"
                    },
                    {
                        class: "ncm-sk-space",
                        buttons: "{space}"
                    }
                ],
                theme: "hg-theme-default ncm-simple-keyboard",
                preventMouseDownDefault: true,
                stopMouseDownPropagation: true
            });
            console.log("MMM-Nextcloud-Calendar: SimpleKeyboard initialized successfully.");
        } catch (e) {
            console.error("MMM-Nextcloud-Calendar: Error initializing keyboard:", e);
            const kb = document.getElementById("ncm-kb-main");
            if (kb) kb.innerHTML = "<div style='color:red; text-align:center;'>Fehler beim Starten der Tastatur: " + e.message + "</div>";
        }
    },

    onKeyboardChange: function (input) {
        if (!this.activeInputField) return;
        this.activeInputField.value = input;
        this.debouncedUpdateSuggestions();
    },

    onKeyPress: function (button) {
        if (button === "{shift}") {
            const currentLayout = this.keyboard.options.layoutName;
            const newLayout = currentLayout === "shift" ? "default" : "shift";

            this.keyboard.setOptions({
                layoutName: newLayout
            });

            if (newLayout === "shift") {
                this.keyboard.addButtonTheme("{shift}", "shift-active-btn");
            } else {
                this.keyboard.removeButtonTheme("{shift}", "shift-active-btn");
            }

        } else if (button === "{numbers}") {
            this.keyboard.setOptions({ layoutName: "numbers" });
        } else if (button === "{symbols}") {
            this.keyboard.setOptions({ layoutName: "symbols" });
        } else if (button === "{abc}") {
            this.keyboard.setOptions({ layoutName: "default" });
        } else if (button === "{enter}") {
            this.onEnterPress();
        } else if (button === "{bksp}") {
            if (this.activeInputField) {
                const input = this.activeInputField;
                const val = input.value;
                const start = input.selectionStart;
                const end = input.selectionEnd;

                if (start === end) {
                    if (start > 0) {
                        const newVal = val.slice(0, start - 1) + val.slice(end);
                        input.value = newVal;
                        this.keyboard.setInput(newVal);
                        input.selectionStart = input.selectionEnd = start - 1;
                    }
                } else {
                    const newVal = val.slice(0, start) + val.slice(end);
                    input.value = newVal;
                    this.keyboard.setInput(newVal);
                    input.selectionStart = input.selectionEnd = start;
                }

                this.debouncedUpdateSuggestions();
            }
        } else {
            // After typing a character in shift mode, revert to lowercase
            if (!button.startsWith("{")) {
                const currentLayout = this.keyboard.options.layoutName;
                if (currentLayout === "shift") {
                    this.keyboard.setOptions({ layoutName: "default" });
                    this.keyboard.removeButtonTheme("{shift}", "shift-active-btn");
                }
            }
        }
    },

    showNumbersKeyboard: function () {
        const kbArea = document.getElementById("ncm-keyboard-area");
        if (!kbArea) return;

        kbArea.innerHTML = "";
        kbArea.appendChild(this.createNumbersKeyboard());
    },

    // Builds the numbers/symbols keyboard layout.
    createNumbersKeyboard: function () {
        const kb = document.createElement("div");
        kb.className = "ncm-kb";
        kb.id = "ncm-kb-numbers";

        const rows = [
            ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
            ["-", "/", ":", ";", "(", ")", "€", "&", "@", "\""],
            ["#+=", ".", ",", "?", "!", "'", "⌫"],
            ["ABC", "Leertaste", "⌫"]
        ];

        rows.forEach(rowKeys => {
            const row = document.createElement("div");
            row.className = "ncm-kb-row";

            rowKeys.forEach(key => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ncm-key";
                btn.addEventListener("mousedown", e => e.preventDefault());

                if (key === "Leertaste") {
                    btn.textContent = "Leertaste";
                    btn.className += " ncm-key-space";
                    btn.addEventListener("click", () => this.insertKey(" "));
                }
                else if (key === "ABC") {
                    btn.textContent = "ABC";
                    btn.className += " ncm-key-toggle";
                    btn.addEventListener("click", () => this.showKeyboard("text"));
                }
                else if (key === "#+=") {
                    btn.textContent = "#+=";
                    btn.className += " ncm-key-toggle";
                    btn.addEventListener("click", () => this.showSymbolsKeyboard());
                }
                else if (key === "⌫") {
                    btn.textContent = "⌫";
                    btn.className += " ncm-key-del";
                    btn.addEventListener("click", () => this.delKey());
                }
                else {
                    btn.textContent = key;
                    btn.addEventListener("click", () => this.insertKey(key));
                }

                row.appendChild(btn);
            });

            kb.appendChild(row);
        });

        return kb;
    },

    showSymbolsKeyboard: function () {
        const kbArea = document.getElementById("ncm-keyboard-area");
        if (!kbArea) return;

        kbArea.innerHTML = "";
        kbArea.appendChild(this.createSymbolsKeyboard());
    },

    // Builds the extended symbols keyboard layout.
    createSymbolsKeyboard: function () {
        const kb = document.createElement("div");
        kb.className = "ncm-kb";

        const rows = [
            ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
            ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"],
            ["123", ".", ",", "?", "!", "'", "⌫"],
            ["ABC", "Leertaste", "⌫"]
        ];

        rows.forEach(rowKeys => {
            const row = document.createElement("div");
            row.className = "ncm-kb-row";

            rowKeys.forEach(key => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ncm-key";
                btn.addEventListener("mousedown", e => e.preventDefault());

                if (key === "Leertaste") {
                    btn.textContent = "Leertaste";
                    btn.className += " ncm-key-space";
                    btn.addEventListener("click", () => this.insertKey(" "));
                }
                else if (key === "ABC") {
                    btn.textContent = "ABC";
                    btn.className += " ncm-key-toggle";
                    btn.addEventListener("click", () => this.showKeyboard("text"));
                }
                else if (key === "123") {
                    btn.textContent = "123";
                    btn.className += " ncm-key-toggle";
                    btn.addEventListener("click", () => this.showNumbersKeyboard());
                }
                else if (key === "⌫") {
                    btn.textContent = "⌫";
                    btn.className += " ncm-key-del";
                    btn.addEventListener("click", () => this.delKey());
                }
                else {
                    btn.textContent = key;
                    btn.addEventListener("click", () => this.insertKey(key));
                }

                row.appendChild(btn);
            });

            kb.appendChild(row);
        });

        return kb;
    },

    // Builds a numeric-only keyboard for time entry (digits 0-9 and colon).
    createTimeKeyboard: function () {
        const kb = document.createElement("div");
        kb.className = "ncm-kb ncm-kb-time";

        const rows = [
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            [":", "0", "⌫"]
        ];

        rows.forEach(rowKeys => {
            const row = document.createElement("div");
            row.className = "ncm-kb-row ncm-kb-row-time";

            rowKeys.forEach(key => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ncm-key ncm-key-time";
                btn.textContent = key;
                btn.addEventListener("mousedown", e => e.preventDefault());

                if (key === "⌫") {
                    btn.className += " ncm-key-del";
                    btn.addEventListener("click", () => this.delTimeKey());
                } else {
                    btn.addEventListener("click", () => this.insertTimeKey(key));
                }

                row.appendChild(btn);
            });

            kb.appendChild(row);
        });

        return kb;
    },

    // Inserts a digit into the time field, auto-inserting the colon after two digits.
    insertTimeKey: function (k) {
        const el = this.activeInputField;
        if (!el) return;

        // Clear field on first keystroke after focus
        if (this.timeInputFirstKey) {
            el.value = "";
            this.timeInputFirstKey = false;
        }

        let val = el.value;

        if (k === ":") {
            if (!val.includes(":") && val.length > 0 && val.length <= 2) {
                el.value = val + ":";
            }
            return;
        }

        if (val.length >= 5) return;

        // Auto-insert colon after two digits
        if (val.length === 2 && !val.includes(":")) {
            val = val + ":";
        }

        el.value = val + k;
    },

    delTimeKey: function () {
        const el = this.activeInputField;
        if (!el || el.value.length === 0) return;
        el.value = el.value.slice(0, -1);
    },

    toggleShift: function () {
        this.shiftActive = !this.shiftActive;

        const shiftBtn = document.getElementById("ncm-shift");
        if (shiftBtn) {
            shiftBtn.classList.toggle("ncm-key-active", this.shiftActive);
        }

        if (this.letterButtons) {
            this.letterButtons.forEach(({ btn, char }) => {
                btn.textContent = this.shiftActive ? char.toUpperCase() : char.toLowerCase();
            });
        }
    },

    onLetterPress: function (char) {
        const textToInsert = this.shiftActive ? char.toUpperCase() : char.toLowerCase();
        this.insertKey(textToInsert);

        if (this.shiftActive) {
            this.toggleShift();
        }
    },

    // Handles Enter: inserts newline in textarea or moves focus to the next field.
    onEnterPress: function () {
        const el = this.activeInputField;
        if (!el) return;

        if (el.tagName === "TEXTAREA") {
            this.insertKey("\n");
            return;
        }

        const titleInput = document.getElementById("ncm-edit-title-input");
        const locInput = document.getElementById("ncm-edit-loc");
        const notesInput = document.getElementById("ncm-edit-notes");

        if (el === titleInput && locInput) {
            locInput.focus();
            this.setActiveInput(locInput);
        } else if (el === locInput && notesInput) {
            notesInput.focus();
            this.setActiveInput(notesInput);
        }

        this.updateSuggestions();
    },

    // Tracks which input field is active and syncs the keyboard state.
    setActiveInput: function (el) {
        if (this.activeInputField === el) return;

        if (this.activeInputField) {
            this.activeInputField.classList.remove("ncm-input-active");
        }

        this.activeInputField = el;
        if (el) {
            el.classList.add("ncm-input-active");
            if (this.keyboard) {
                this.keyboard.setInput(el.value || "");
            }
        }
    },

    // Inserts text at the cursor position in the active input field.
    insertKey: function (k) {
        if (!this.activeInputField) this.activeInputField = document.getElementById("ncm-edit-title-input");
        const el = this.activeInputField;
        if (!el) return;

        const s = el.selectionStart ?? el.value.length;
        const e = el.selectionEnd ?? el.value.length;
        el.value = el.value.slice(0, s) + k + el.value.slice(e);
        el.selectionStart = el.selectionEnd = s + k.length;

        this.debouncedUpdateSuggestions();
    },

    // Debounces suggestion updates to avoid blocking rapid key presses.
    debouncedUpdateSuggestions: function () {
        if (this.suggestionsTimer) {
            clearTimeout(this.suggestionsTimer);
        }
        this.suggestionsTimer = setTimeout(() => {
            requestAnimationFrame(() => {
                this.updateSuggestions();
            });
        }, 300);
    },

    // Deletes the character before the cursor (or the selected range).
    delKey: function () {
        const el = this.activeInputField;
        if (!el) return;

        const s = el.selectionStart ?? el.value.length;
        const e = el.selectionEnd ?? el.value.length;

        if (s === e && s > 0) {
            el.value = el.value.slice(0, s - 1) + el.value.slice(e);
            el.selectionStart = el.selectionEnd = s - 1;
        } else if (s !== e) {
            el.value = el.value.slice(0, s) + el.value.slice(e);
            el.selectionStart = el.selectionEnd = s;
        }

        this.debouncedUpdateSuggestions();
    },

    closeAllModals: function () {
        document.querySelectorAll(".ncm-modal").forEach(m => m.classList.add("ncm-hidden"));
        this.editingEvent = null;
        this.shiftActive = false;
        this.keyboardMode = "text";
        if (this.suggestionsTimer) {
            clearTimeout(this.suggestionsTimer);
            this.suggestionsTimer = null;
        }
    },

    // Formats an event's time range as a localised string.
    formatTime: function (ev) {
        const s = new Date(ev.start);
        let e = new Date(ev.end);

        if (ev.isAllDay) {
            // Subtract 1 day because iCalendar DTEND is exclusive
            e = new Date(e.getTime() - 86400000);
            const sameDay = s.toDateString() === e.toDateString();
            if (sameDay) return s.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" }) + ", Ganztag";
            return s.toLocaleDateString("de-CH", { day: "numeric", month: "short" }) + " - " + e.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" }) + ", Ganztag";
        }

        const sameDay = s.toDateString() === e.toDateString();
        const timeS = s.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
        const timeE = e.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

        if (sameDay) {
            return s.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" }) + ", " + timeS + " - " + timeE;
        }
        return s.toLocaleDateString("de-CH", { day: "numeric", month: "short" }) + " " + timeS + " - " + e.toLocaleDateString("de-CH", { day: "numeric", month: "short" }) + " " + timeE;
    },

    // Converts a hex colour string to an rgba() value with the given opacity.
    hexToRgba: function (hex, alpha) {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    // Creates the shared alert/confirm/loading modal element.
    createAlertModal: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-alert-modal";

        const c = document.createElement("div");
        c.className = "ncm-modal-content ncm-modal-alert";

        const msg = document.createElement("div");
        msg.id = "ncm-alert-msg";
        msg.className = "ncm-alert-text";

        const btns = document.createElement("div");
        btns.className = "ncm-alert-btns";
        btns.id = "ncm-alert-btns";

        c.append(msg, btns);
        m.appendChild(c);
        return m;
    },

    // Shows a spinner with an optional status message.
    showLoading: function (message) {
        const modal = document.getElementById("ncm-alert-modal");
        const msg = document.getElementById("ncm-alert-msg");
        const btns = document.getElementById("ncm-alert-btns");

        msg.innerHTML = "";
        const spinner = document.createElement("div");
        spinner.className = "ncm-spinner";
        msg.appendChild(spinner);

        const text = document.createElement("div");
        text.textContent = message || "Bitte warten…";
        text.style.marginTop = "4px";
        msg.appendChild(text);

        btns.innerHTML = "";
        modal.classList.remove("ncm-hidden");
    },

    // Shows an alert with a single OK button.
    showAlert: function (message) {
        const modal = document.getElementById("ncm-alert-modal");
        const msgEl = document.getElementById("ncm-alert-msg");
        msgEl.innerHTML = "";
        msgEl.textContent = message;

        const btns = document.getElementById("ncm-alert-btns");
        btns.innerHTML = "";

        const ok = document.createElement("button");
        ok.className = "ncm-btn ncm-btn-primary ncm-btn-full";
        ok.textContent = "OK";
        ok.addEventListener("click", () => modal.classList.add("ncm-hidden"));
        btns.appendChild(ok);

        modal.classList.remove("ncm-hidden");
    },

    // Shows a confirm dialog with Cancel and Delete buttons.
    showConfirm: function (message, onConfirm) {
        const modal = document.getElementById("ncm-alert-modal");
        const msgEl = document.getElementById("ncm-alert-msg");
        msgEl.innerHTML = "";
        msgEl.textContent = message;

        const btns = document.getElementById("ncm-alert-btns");
        btns.innerHTML = "";

        const cancel = document.createElement("button");
        cancel.className = "ncm-btn ncm-btn-secondary";
        cancel.textContent = "Abbrechen";
        cancel.addEventListener("click", () => modal.classList.add("ncm-hidden"));

        const confirm = document.createElement("button");
        confirm.className = "ncm-btn ncm-btn-danger";
        confirm.textContent = "Löschen";
        confirm.addEventListener("click", () => {
            modal.classList.add("ncm-hidden");
            onConfirm();
        });

        btns.append(cancel, confirm);
        modal.classList.remove("ncm-hidden");
    },

    // Shows a choice dialog for recurring events (cancel / act on whole series).
    showRecurringChoice: function (title, actionType, onChoice) {
        const modal = document.getElementById("ncm-alert-modal");
        const msg = document.getElementById("ncm-alert-msg");
        msg.innerHTML = "";
        msg.textContent = title;

        const btns = document.getElementById("ncm-alert-btns");
        btns.innerHTML = "";

        const cancel = document.createElement("button");
        cancel.className = "ncm-btn ncm-btn-secondary";
        cancel.textContent = "Abbrechen";
        cancel.addEventListener("click", () => modal.classList.add("ncm-hidden"));

        const allBtn = document.createElement("button");
        if (actionType === "delete") {
            allBtn.className = "ncm-btn ncm-btn-danger";
            allBtn.textContent = "Ganze Serie löschen";
        } else {
            allBtn.className = "ncm-btn ncm-btn-primary";
            allBtn.textContent = "Ganze Serie bearbeiten";
        }
        allBtn.addEventListener("click", () => {
            modal.classList.add("ncm-hidden");
            onChoice("all");
        });

        btns.append(cancel, allBtn);
        modal.classList.remove("ncm-hidden");
    },

    // Creates the date picker modal container (content rendered on open).
    createDatePicker: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-datepicker-modal";
        m.addEventListener("click", (e) => {
            if (e.target === m) m.classList.add("ncm-hidden");
        });

        const c = document.createElement("div");
        c.className = "ncm-modal-content ncm-datepicker";
        c.id = "ncm-datepicker-content";

        m.appendChild(c);
        return m;
    },

    openDatePicker: function (type) {
        console.log("openDatePicker called with type:", type);
        this.datePickerType = type;
        const date = type === "start" ? this.editStartDate : this.editEndDate;
        console.log("Date for picker:", date);
        this.pickerViewDate = new Date(date);

        this.renderDatePicker();
        const modal = document.getElementById("ncm-datepicker-modal");
        console.log("Datepicker modal element:", modal);
        if (modal) {
            modal.classList.remove("ncm-hidden");
            console.log("Datepicker modal opened");
        } else {
            console.error("Datepicker modal not found!");
        }
    },

    // Renders the mini calendar grid inside the date picker modal.
    renderDatePicker: function () {
        const c = document.getElementById("ncm-datepicker-content");
        const d = this.pickerViewDate;
        const year = d.getFullYear();
        const month = d.getMonth();
        const selected = this.datePickerType === "start" ? this.editStartDate : this.editEndDate;

        c.innerHTML = "";

        const header = document.createElement("div");
        header.className = "ncm-picker-header";

        const prevBtn = document.createElement("button");
        prevBtn.className = "ncm-btn ncm-btn-icon";
        prevBtn.innerHTML = this.icon("left");
        prevBtn.addEventListener("click", () => this.stepPickerMonth(-1));

        const title = document.createElement("span");
        title.className = "ncm-picker-title";
        title.textContent = `${this.getMonthName(month)} ${year}`;

        const nextBtn = document.createElement("button");
        nextBtn.className = "ncm-btn ncm-btn-icon";
        nextBtn.innerHTML = this.icon("right");
        nextBtn.addEventListener("click", () => this.stepPickerMonth(1));

        header.append(prevBtn, title, nextBtn);
        c.appendChild(header);

        const weekdays = document.createElement("div");
        weekdays.className = "ncm-picker-weekdays";
        ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach(d => {
            const span = document.createElement("span");
            span.textContent = d;
            weekdays.appendChild(span);
        });
        c.appendChild(weekdays);

        const grid = document.createElement("div");
        grid.className = "ncm-picker-grid";

        const first = new Date(year, month, 1);
        const last = new Date(year, month + 1, 0);
        let dow = first.getDay() - 1;
        if (dow < 0) dow = 6;

        // Padding cells from the previous month
        const prev = new Date(year, month, 0);
        for (let i = dow - 1; i >= 0; i--) {
            const span = document.createElement("span");
            span.className = "ncm-picker-day ncm-picker-other";
            span.textContent = prev.getDate() - i;
            grid.appendChild(span);
        }

        for (let i = 1; i <= last.getDate(); i++) {
            const thisDate = new Date(year, month, i);
            const isSelected = thisDate.toDateString() === selected.toDateString();
            const isToday = thisDate.toDateString() === new Date().toDateString();

            const span = document.createElement("span");
            span.className = "ncm-picker-day";
            if (isSelected) span.classList.add("ncm-picker-selected");
            if (isToday) span.classList.add("ncm-picker-today");
            span.textContent = i;
            span.addEventListener("click", () => this.selectPickerDate(i));
            grid.appendChild(span);
        }

        // Padding cells from the next month
        const total = dow + last.getDate();
        const rem = (7 - (total % 7)) % 7;
        for (let i = 1; i <= rem; i++) {
            const span = document.createElement("span");
            span.className = "ncm-picker-day ncm-picker-other";
            span.textContent = i;
            grid.appendChild(span);
        }

        c.appendChild(grid);
    },

    stepPickerMonth: function (dir) {
        this.pickerViewDate.setMonth(this.pickerViewDate.getMonth() + dir);
        this.renderDatePicker();
    },

    selectPickerDate: function (day) {
        const d = this.datePickerType === "start" ? this.editStartDate : this.editEndDate;
        d.setFullYear(this.pickerViewDate.getFullYear());
        d.setMonth(this.pickerViewDate.getMonth());
        d.setDate(day);

        if (this.datePickerType === "start" && this.editStartDate >= this.editEndDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }
        if (this.datePickerType === "end" && this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }

        document.getElementById("ncm-datepicker-modal").classList.add("ncm-hidden");
        this.updateWheels();
    },

    // Creates the time picker modal container (content rendered on open).
    createTimePicker: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-timepicker-modal";
        m.addEventListener("click", (e) => {
            if (e.target === m) m.classList.add("ncm-hidden");
        });

        const c = document.createElement("div");
        c.className = "ncm-modal-content ncm-timepicker";
        c.id = "ncm-timepicker-content";

        m.appendChild(c);
        return m;
    },

    openTimePicker: function (type) {
        this.timePickerType = type;
        this.renderTimePicker();
        document.getElementById("ncm-timepicker-modal").classList.remove("ncm-hidden");
    },

    // Renders scroll wheels for hour and minute selection.
    renderTimePicker: function () {
        const c = document.getElementById("ncm-timepicker-content");
        const d = this.timePickerType === "start" ? this.editStartDate : this.editEndDate;
        this.tempHour = d.getHours();
        this.tempMinute = d.getMinutes();

        c.innerHTML = "";

        const title = document.createElement("div");
        title.className = "ncm-picker-title";
        title.textContent = "Zeit wählen";
        c.appendChild(title);

        const wheels = document.createElement("div");
        wheels.className = "ncm-scroll-wheels";

        const hourWheel = this.createScrollWheel("hour", 24, this.tempHour);
        wheels.appendChild(hourWheel);

        const sep = document.createElement("div");
        sep.className = "ncm-wheel-sep";
        sep.textContent = ":";
        wheels.appendChild(sep);

        const minWheel = this.createScrollWheel("minute", 60, this.tempMinute);
        wheels.appendChild(minWheel);

        c.appendChild(wheels);

        const okBtn = document.createElement("button");
        okBtn.className = "ncm-btn ncm-btn-primary ncm-btn-full";
        okBtn.textContent = "OK";
        okBtn.style.marginTop = "16px";
        okBtn.addEventListener("click", () => this.confirmTime());
        c.appendChild(okBtn);
    },

    // Builds a single scrollable column for hours or minutes.
    createScrollWheel: function (type, max, current) {
        const container = document.createElement("div");
        container.className = "ncm-scroll-container";

        const list = document.createElement("div");
        list.className = "ncm-scroll-list";
        list.id = `ncm-scroll-${type}`;

        for (let i = 0; i < max; i++) {
            const item = document.createElement("div");
            item.className = "ncm-scroll-item";
            if (i === current) item.classList.add("ncm-scroll-selected");
            item.textContent = String(i).padStart(2, "0");
            item.dataset.value = i;
            item.addEventListener("click", () => {
                if (type === "hour") this.tempHour = i;
                else this.tempMinute = i;
                this.updateScrollSelection(type, i);
            });
            list.appendChild(item);
        }

        container.appendChild(list);

        // Scroll to the initially selected item
        setTimeout(() => {
            const selectedItem = list.querySelector(".ncm-scroll-selected");
            if (selectedItem) {
                list.scrollTop = selectedItem.offsetTop - list.offsetHeight / 2 + selectedItem.offsetHeight / 2;
            }
        }, 50);

        return container;
    },

    updateScrollSelection: function (type, value) {
        const list = document.getElementById(`ncm-scroll-${type}`);
        list.querySelectorAll(".ncm-scroll-item").forEach(item => {
            item.classList.remove("ncm-scroll-selected");
            if (parseInt(item.dataset.value) === value) {
                item.classList.add("ncm-scroll-selected");
            }
        });
    },

    // Creates the iOS-style drum (scroll-snap) picker modal.
    createDrumPicker: function () {
        const m = document.createElement("div");
        m.className = "ncm-modal ncm-hidden";
        m.id = "ncm-drum-modal";
        m.addEventListener("click", (e) => {
            if (e.target === m) this.closeDrumPicker();
        });

        const c = document.createElement("div");
        c.className = "ncm-drum-container";
        c.id = "ncm-drum-content";

        m.appendChild(c);
        return m;
    },

    openDrumPicker: function (type) {
        this.drumPickerType = type;
        const d = type === "start" ? new Date(this.editStartDate) : new Date(this.editEndDate);
        this.tempDate = {
            day: d.getDate(),
            month: d.getMonth() + 1,
            year: d.getFullYear(),
            hour: d.getHours(),
            minute: d.getMinutes()
        };

        this.renderDrumPicker();
        document.getElementById("ncm-drum-modal").classList.remove("ncm-hidden");
    },

    // Renders the drum picker with day/month/year (and optionally hour/minute) columns.
    renderDrumPicker: function () {
        const c = document.getElementById("ncm-drum-content");
        const allDay = document.getElementById("ncm-edit-allday")?.checked;

        c.innerHTML = "";

        const title = document.createElement("div");
        title.className = "ncm-drum-title";
        title.textContent = this.drumPickerType === "start" ? "Startzeit" : "Endzeit";
        c.appendChild(title);

        const drums = document.createElement("div");
        drums.className = "ncm-drums";

        drums.appendChild(this.createDrum("day", 31, this.tempDate.day, 1));
        drums.appendChild(this.createDrum("month", 12, this.tempDate.month, 1, ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]));
        drums.appendChild(this.createYearDrum(this.tempDate.year));

        if (!allDay) {
            const sep = document.createElement("div");
            sep.className = "ncm-drum-sep";
            drums.appendChild(sep);

            drums.appendChild(this.createDrum("hour", 24, this.tempDate.hour, 0));

            const colon = document.createElement("div");
            colon.className = "ncm-drum-colon";
            colon.textContent = ":";
            drums.appendChild(colon);

            drums.appendChild(this.createDrum("minute", 60, this.tempDate.minute, 0));
        }

        c.appendChild(drums);

        // Highlight bar centred over the selected row
        const highlight = document.createElement("div");
        highlight.className = "ncm-drum-highlight";
        drums.appendChild(highlight);

        const okBtn = document.createElement("button");
        okBtn.className = "ncm-btn ncm-btn-primary ncm-btn-full";
        okBtn.textContent = "OK";
        okBtn.addEventListener("click", () => this.confirmDrumPicker());
        c.appendChild(okBtn);
    },

    // Creates a single drum column with scroll-snap and optional label array.
    createDrum: function (type, max, current, startFrom, labels = null) {
        const drum = document.createElement("div");
        drum.className = "ncm-drum";
        drum.dataset.type = type;
        drum.dataset.max = max;
        drum.dataset.startFrom = startFrom;

        const list = document.createElement("div");
        list.className = "ncm-drum-list";

        // Top padding items for smoother overscroll feel
        for (let p = 0; p < 3; p++) {
            const pad = document.createElement("div");
            pad.className = "ncm-drum-item ncm-drum-pad";
            list.appendChild(pad);
        }

        for (let i = startFrom; i < max + startFrom; i++) {
            const item = document.createElement("div");
            item.className = "ncm-drum-item";
            item.dataset.value = i;

            if (labels) {
                item.textContent = labels[i - startFrom];
            } else {
                item.textContent = String(i).padStart(2, "0");
            }

            item.addEventListener("click", () => {
                this.tempDate[type] = i;
                this.scrollDrumToValue(drum, i, startFrom);
            });

            list.appendChild(item);
        }

        // Bottom padding items
        for (let p = 0; p < 3; p++) {
            const pad = document.createElement("div");
            pad.className = "ncm-drum-item ncm-drum-pad";
            list.appendChild(pad);
        }

        drum.appendChild(list);

        setTimeout(() => this.scrollDrumToValue(drum, current, startFrom), 50);

        return drum;
    },

    // Creates the year drum showing currentYear-2 to currentYear+5.
    createYearDrum: function (currentYear) {
        const drum = document.createElement("div");
        drum.className = "ncm-drum ncm-drum-year";
        drum.dataset.type = "year";

        const list = document.createElement("div");
        list.className = "ncm-drum-list";

        for (let p = 0; p < 2; p++) {
            const pad = document.createElement("div");
            pad.className = "ncm-drum-item ncm-drum-pad";
            list.appendChild(pad);
        }

        const startYear = currentYear - 2;
        const endYear = currentYear + 5;

        for (let y = startYear; y <= endYear; y++) {
            const item = document.createElement("div");
            item.className = "ncm-drum-item";
            item.dataset.value = y;
            item.textContent = y;
            item.addEventListener("click", () => {
                this.tempDate.year = y;
                this.scrollDrumToValue(drum, y, startYear);
            });
            list.appendChild(item);
        }

        for (let p = 0; p < 2; p++) {
            const pad = document.createElement("div");
            pad.className = "ncm-drum-item ncm-drum-pad";
            list.appendChild(pad);
        }

        drum.appendChild(list);
        setTimeout(() => this.scrollDrumToValue(drum, currentYear, startYear), 50);

        return drum;
    },

    // Scrolls a drum list so that the given value is centred.
    scrollDrumToValue: function (drum, value, startFrom) {
        const list = drum.querySelector(".ncm-drum-list");
        const itemHeight = 40;
        const index = value - startFrom;
        list.scrollTop = index * itemHeight;
    },

    // Reads the current scroll position of all drums and writes them to tempDate.
    readDrumValues: function () {
        const drums = document.querySelectorAll(".ncm-drum");
        drums.forEach(drum => {
            const type = drum.dataset.type;
            const list = drum.querySelector(".ncm-drum-list");
            const itemHeight = 40;
            const index = Math.round(list.scrollTop / itemHeight);

            if (type === "day") this.tempDate.day = index + 1;
            else if (type === "month") this.tempDate.month = index + 1;
            else if (type === "year") {
                const currentYear = new Date().getFullYear();
                this.tempDate.year = (currentYear - 2) + index;
            }
            else if (type === "hour") this.tempDate.hour = index;
            else if (type === "minute") this.tempDate.minute = index;
        });
    },

    // Applies the drum picker selection to the edit dates and closes the picker.
    confirmDrumPicker: function () {
        this.readDrumValues();

        const d = this.drumPickerType === "start" ? this.editStartDate : this.editEndDate;

        d.setFullYear(this.tempDate.year);
        d.setMonth(this.tempDate.month - 1);
        d.setDate(this.tempDate.day);
        d.setHours(this.tempDate.hour);
        d.setMinutes(this.tempDate.minute);

        if (this.drumPickerType === "start" && this.editStartDate >= this.editEndDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }
        if (this.drumPickerType === "end" && this.editEndDate <= this.editStartDate) {
            this.editEndDate = new Date(this.editStartDate.getTime() + 3600000);
        }

        this.closeDrumPicker();
        this.updateDateButtons();
    },

    closeDrumPicker: function () {
        document.getElementById("ncm-drum-modal").classList.add("ncm-hidden");
    },
});
