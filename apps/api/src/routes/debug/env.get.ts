import { defineEventHandler } from "../../lib/handler.js";

export default defineEventHandler(async (event) => {
    return process.env;
});