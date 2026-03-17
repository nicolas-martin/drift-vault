"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollingVaultSubscriber = void 0;
const pollingVaultsProgramAccountSubscriber_1 = require("./pollingVaultsProgramAccountSubscriber");
class PollingVaultSubscriber extends pollingVaultsProgramAccountSubscriber_1.PollingVaultsProgramAccountSubscriber {
    async addToAccountLoader() {
        if (this.callbackId) {
            console.log('Account for vault already added to account loader');
            return;
        }
        this.callbackId = await this.accountLoader.addAccount(this.pubkey, (buffer, slot) => {
            if (!buffer)
                return;
            if (this.account && this.account.slot > slot) {
                return;
            }
            const account = this.program.account.vault.coder.accounts.decode('vault', buffer);
            this.account = { data: account, slot };
            this._eventEmitter.emit('vaultUpdate', account);
            this._eventEmitter.emit('update');
        });
        this.errorCallbackId = this.accountLoader.addErrorCallbacks((error) => {
            this._eventEmitter.emit('error', error);
        });
    }
    async fetch() {
        var _a, _b;
        await this.accountLoader.load();
        const bufferAndSlot = this.accountLoader.getBufferAndSlot(this.pubkey);
        if (!bufferAndSlot)
            return;
        const currentSlot = (_b = (_a = this.account) === null || _a === void 0 ? void 0 : _a.slot) !== null && _b !== void 0 ? _b : 0;
        if (bufferAndSlot.buffer && bufferAndSlot.slot > currentSlot) {
            const account = this.program.account.vault.coder.accounts.decode('vault', bufferAndSlot.buffer);
            this.account = { data: account, slot: bufferAndSlot.slot };
        }
    }
    updateData(vaultAcc, slot) {
        if (!this.account || this.account.slot < slot) {
            this.account = { data: vaultAcc, slot };
            this._eventEmitter.emit('vaultUpdate', vaultAcc);
            this._eventEmitter.emit('update');
        }
    }
}
exports.PollingVaultSubscriber = PollingVaultSubscriber;
