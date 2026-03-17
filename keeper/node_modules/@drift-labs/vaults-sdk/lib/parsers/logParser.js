"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogParser = void 0;
class LogParser {
    constructor(program) {
        this.program = program;
    }
    parseEventsFromLogs(event) {
        const records = [];
        // @ts-ignore
        const eventGenerator = this.program._events._eventParser.parseLogs(event.logs, false);
        for (const eventLog of eventGenerator) {
            eventLog.data.txSig = event.txSig;
            eventLog.data.slot = event.slot;
            eventLog.data.eventType = eventLog.name;
            records.push(eventLog.data);
        }
        return records;
    }
}
exports.LogParser = LogParser;
