"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollingVaultsProgramAccountSubscriber = void 0;
const sdk_1 = require("@drift-labs/sdk");
const events_1 = require("events");
class PollingVaultsProgramAccountSubscriber {
    constructor(program, accountPubkey, accountLoader) {
        this.callbackId = null;
        this.errorCallbackId = null;
        this.accountLoader = accountLoader;
        this._isSubscribed = false;
        this.pubkey = accountPubkey;
        this.program = program;
        // @ts-ignore
        this._eventEmitter = new events_1.EventEmitter();
    }
    get isSubscribed() {
        return this._isSubscribed;
    }
    get eventEmitter() {
        return this._eventEmitter;
    }
    async subscribe() {
        if (this._isSubscribed) {
            return true;
        }
        try {
            await this.addToAccountLoader();
            await this.fetchIfUnloaded();
            if (this.account) {
                // @ts-ignore
                this._eventEmitter.emit('update');
            }
            this._isSubscribed = true;
            return true;
        }
        catch (err) {
            console.error(err);
            this._isSubscribed = false;
            return false;
        }
    }
    async unsubscribe() {
        if (!this._isSubscribed) {
            return;
        }
        this.accountLoader.removeAccount(this.pubkey, this.callbackId);
        this.callbackId = null;
        this.accountLoader.removeErrorCallbacks(this.errorCallbackId);
        this.errorCallbackId = null;
        this._isSubscribed = false;
    }
    async fetchIfUnloaded() {
        if (this.account === undefined) {
            await this.fetch();
        }
    }
    assertIsSubscribed() {
        if (!this._isSubscribed) {
            throw new sdk_1.NotSubscribedError('You must call `subscribe` before using this function');
        }
    }
    getAccountAndSlot() {
        this.assertIsSubscribed();
        if (!this.account) {
            throw new Error('Account not loaded');
        }
        return this.account;
    }
}
exports.PollingVaultsProgramAccountSubscriber = PollingVaultsProgramAccountSubscriber;
