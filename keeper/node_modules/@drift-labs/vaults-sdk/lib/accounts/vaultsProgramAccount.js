"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultsProgramAccount = void 0;
class VaultsProgramAccount {
    get isSubscribed() {
        return this.accountSubscriber.isSubscribed;
    }
    get eventEmitter() {
        return this.accountSubscriber.eventEmitter;
    }
    async subscribe() {
        return await this.accountSubscriber.subscribe();
    }
    async unsubscribe() {
        return await this.accountSubscriber.unsubscribe();
    }
    getData() {
        var _a;
        return (_a = this.accountSubscriber.getAccountAndSlot()) === null || _a === void 0 ? void 0 : _a.data;
    }
    async updateData(newData, slot) {
        return await this.accountSubscriber.updateData(newData, slot);
    }
}
exports.VaultsProgramAccount = VaultsProgramAccount;
