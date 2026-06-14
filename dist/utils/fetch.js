"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.anilistClient = void 0;
exports.makeClient = makeClient;
exports.makeAjaxClient = makeAjaxClient;
const axios_1 = __importDefault(require("axios"));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
function makeClient(baseURL, referer, extra) {
    return axios_1.default.create({
        baseURL,
        timeout: 15000,
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': referer,
            'Origin': new URL(referer).origin,
            'X-Requested-With': 'XMLHttpRequest',
            ...extra,
        },
    });
}
function makeAjaxClient(baseURL, referer, extra) {
    return makeClient(baseURL, referer, {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        ...extra,
    });
}
exports.anilistClient = axios_1.default.create({
    baseURL: 'https://graphql.anilist.co',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
});
//# sourceMappingURL=fetch.js.map