"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultAccount = void 0;
const sdk_1 = require("@drift-labs/sdk");
const accountSubscribers_1 = require("../accountSubscribers");
const vaultsProgramAccount_1 = require("./vaultsProgramAccount");
const addresses_1 = require("../addresses");
const name_1 = require("../name");
class VaultAccount extends vaultsProgramAccount_1.VaultsProgramAccount {
    constructor(program, vaultPubkey, accountLoader, accountSubscriptionType = 'polling') {
        super();
        if (accountSubscriptionType === 'polling') {
            this.accountSubscriber = new accountSubscribers_1.PollingVaultSubscriber(program, vaultPubkey, accountLoader);
        }
        else {
            throw new Error('Websocket subscription not yet implemented');
        }
    }
    static getAddressSync(programId, vaultName) {
        return (0, addresses_1.getVaultAddressSync)(programId, (0, name_1.encodeName)(vaultName));
    }
    /**
     * Calculates the new total shares and management fee shares after a management fee is applied.
     * Only applies to deposits.
     * Management fee is applied to a depositor's existing equity, and the total shares are updated (increased) accordingly.
     * @param vaultEquity - The equity of the vault.
     * @returns An object containing the new total shares and management fee shares.
     */
    calcSharesAfterManagementFee(vaultEquity) {
        const accountData = this.accountSubscriber.getAccountAndSlot().data;
        const depositorsEquity = accountData.userShares
            .mul(vaultEquity)
            .div(accountData.totalShares);
        if (accountData.managementFee.eq(sdk_1.ZERO) || depositorsEquity.lte(sdk_1.ZERO)) {
            return {
                totalShares: accountData.totalShares,
                managementFeeShares: sdk_1.ZERO,
            };
        }
        const now = new sdk_1.BN(Date.now() / 1000);
        const sinceLast = now.sub(accountData.lastFeeUpdateTs);
        let managementFeeAmount = depositorsEquity
            .mul(accountData.managementFee)
            .div(sdk_1.PERCENTAGE_PRECISION)
            .mul(sinceLast)
            .div(sdk_1.ONE_YEAR);
        managementFeeAmount = sdk_1.BN.min(managementFeeAmount, depositorsEquity.sub(sdk_1.ONE));
        const newTotalSharesFactor = depositorsEquity
            .mul(sdk_1.PERCENTAGE_PRECISION)
            .div(depositorsEquity.sub(managementFeeAmount));
        let newTotalShares = accountData.totalShares
            .mul(newTotalSharesFactor)
            .div(sdk_1.PERCENTAGE_PRECISION);
        newTotalShares = sdk_1.BN.max(newTotalShares, accountData.userShares);
        const managementFeeShares = newTotalShares.sub(accountData.totalShares);
        return { totalShares: newTotalShares, managementFeeShares };
    }
    calcSharesAfterManagementAndProtocolFee(vaultEquity, vaultProtocol) {
        const accountData = this.accountSubscriber.getAccountAndSlot().data;
        if (!accountData.vaultProtocol) {
            throw new Error('VaultProtocol does not exist for vault');
        }
        const depositorsEquity = accountData.userShares
            .mul(vaultEquity)
            .div(accountData.totalShares);
        const now = new sdk_1.BN(Date.now() / 1000);
        const sinceLast = now.sub(accountData.lastFeeUpdateTs);
        if (!accountData.managementFee.eq(sdk_1.ZERO) &&
            !vaultProtocol.protocolFee.eq(sdk_1.ZERO) &&
            depositorsEquity.gt(sdk_1.ZERO)) {
            const totalFee = accountData.managementFee.add(vaultProtocol.protocolFee);
            const totalFeePayment = depositorsEquity
                .mul(totalFee)
                .div(sdk_1.PERCENTAGE_PRECISION)
                .mul(sinceLast)
                .div(sdk_1.ONE_YEAR);
            const managementFeePayment = depositorsEquity
                .mul(accountData.managementFee)
                .div(sdk_1.PERCENTAGE_PRECISION)
                .mul(sinceLast)
                .div(sdk_1.ONE_YEAR);
            const protocolFeePayment = sdk_1.BN.min(totalFeePayment, depositorsEquity.sub(new sdk_1.BN(1)))
                .mul(vaultProtocol.protocolFee)
                .div(totalFee);
            const newTotalSharesFactor = depositorsEquity
                .mul(sdk_1.PERCENTAGE_PRECISION)
                .div(depositorsEquity.sub(managementFeePayment).sub(protocolFeePayment));
            const newTotalShares = sdk_1.BN.max(accountData.totalShares
                .mul(newTotalSharesFactor)
                .div(sdk_1.PERCENTAGE_PRECISION), accountData.userShares);
            if ((managementFeePayment.eq(sdk_1.ZERO) && protocolFeePayment.eq(sdk_1.ZERO)) ||
                accountData.totalShares.eq(newTotalShares)) {
                return {
                    totalShares: accountData.totalShares,
                    managementFeeShares: sdk_1.ZERO,
                    protocolFeeShares: sdk_1.ZERO,
                };
            }
            const managementFeeShares = newTotalShares.sub(accountData.totalShares);
            const protocolFeeShares = newTotalShares.sub(accountData.totalShares);
            return {
                totalShares: newTotalShares,
                managementFeeShares,
                protocolFeeShares,
            };
        }
        else if (accountData.managementFee.eq(sdk_1.ZERO) &&
            !vaultProtocol.protocolFee.eq(sdk_1.ZERO) &&
            depositorsEquity.gt(sdk_1.ZERO)) {
            const protocolFeePayment = depositorsEquity
                .mul(vaultProtocol.protocolFee)
                .div(sdk_1.PERCENTAGE_PRECISION)
                .mul(sinceLast)
                .div(sdk_1.ONE_YEAR);
            const newTotalSharesFactor = depositorsEquity
                .mul(sdk_1.PERCENTAGE_PRECISION)
                .div(depositorsEquity.sub(protocolFeePayment));
            const newTotalShares = sdk_1.BN.max(accountData.totalShares
                .mul(newTotalSharesFactor)
                .div(sdk_1.PERCENTAGE_PRECISION), accountData.userShares);
            if (protocolFeePayment.eq(sdk_1.ZERO) ||
                accountData.totalShares.eq(newTotalShares)) {
                return {
                    totalShares: accountData.totalShares,
                    managementFeeShares: sdk_1.ZERO,
                    protocolFeeShares: sdk_1.ZERO,
                };
            }
            const protocolFeeShares = newTotalShares.sub(accountData.totalShares);
            return {
                totalShares: newTotalShares,
                managementFeeShares: sdk_1.ZERO,
                protocolFeeShares,
            };
        }
        else if (!accountData.managementFee.eq(sdk_1.ZERO) &&
            vaultProtocol.protocolFee.eq(sdk_1.ZERO) &&
            depositorsEquity.gt(sdk_1.ZERO)) {
            const managementFeePayment = sdk_1.BN.min(depositorsEquity
                .mul(accountData.managementFee)
                .div(sdk_1.PERCENTAGE_PRECISION)
                .mul(sinceLast)
                .div(sdk_1.ONE_YEAR), depositorsEquity.sub(sdk_1.ONE));
            const newTotalSharesFactor = depositorsEquity
                .mul(sdk_1.PERCENTAGE_PRECISION)
                .div(depositorsEquity.sub(managementFeePayment));
            const newTotalShares = sdk_1.BN.max(accountData.totalShares
                .mul(newTotalSharesFactor)
                .div(sdk_1.PERCENTAGE_PRECISION), accountData.userShares);
            if (managementFeePayment.eq(sdk_1.ZERO) ||
                accountData.totalShares.eq(newTotalShares)) {
                return {
                    totalShares: accountData.totalShares,
                    managementFeeShares: sdk_1.ZERO,
                    protocolFeeShares: sdk_1.ZERO,
                };
            }
            const managementFeeShares = newTotalShares.sub(accountData.totalShares);
            return {
                totalShares: newTotalShares,
                managementFeeShares,
                protocolFeeShares: sdk_1.ZERO,
            };
        }
        else {
            return {
                totalShares: accountData.totalShares,
                managementFeeShares: sdk_1.ZERO,
                protocolFeeShares: sdk_1.ZERO,
            };
        }
    }
}
exports.VaultAccount = VaultAccount;
