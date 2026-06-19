"use strict";
/**
 * @maxtindall/portal-sdk
 * Client library for Portal key purchase, validation, and session management.
 *
 * @example
 * ```ts
 * import { validatePortalKey, buildPurchaseTransaction } from '@maxtindall/portal-sdk';
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDL = exports.PROGRAM_ID = exports.getKeyRecord = exports.buildPurchaseTransaction = exports.validatePortalKey = void 0;
var validate_1 = require("./validate");
Object.defineProperty(exports, "validatePortalKey", { enumerable: true, get: function () { return validate_1.validatePortalKey; } });
var purchase_1 = require("./purchase");
Object.defineProperty(exports, "buildPurchaseTransaction", { enumerable: true, get: function () { return purchase_1.buildPurchaseTransaction; } });
Object.defineProperty(exports, "getKeyRecord", { enumerable: true, get: function () { return purchase_1.getKeyRecord; } });
var portal_idl_1 = require("@maxtindall/portal-idl");
Object.defineProperty(exports, "PROGRAM_ID", { enumerable: true, get: function () { return portal_idl_1.PROGRAM_ID; } });
Object.defineProperty(exports, "IDL", { enumerable: true, get: function () { return portal_idl_1.IDL; } });
//# sourceMappingURL=index.js.map