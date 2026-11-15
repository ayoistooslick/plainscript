import { serve, json, notFound, requestJson, urlOf } from "../../../stdlib/http.js";
import { print, env } from "../../../stdlib/io.js";
import { append, count } from "../../../stdlib/list.js";
import { parseNumber } from "../../../stdlib/text.js";
let tickets = [{ id: 1, title: "first ticket", done: false }];
let nextId = 2;
async function handler(request) {
    let url = urlOf(request);
    let method = request.method;
    if (((method == "GET") && (url.pathname == "/health"))) {
        return json({ status: "ok", tickets: count(tickets) });
    }
    if (((method == "GET") && (url.pathname == "/tickets"))) {
        return json(tickets);
    }
    if (((method == "GET") && (url.pathname == "/tickets/1"))) {
        return json(tickets[0]);
    }
    if (((method == "POST") && (url.pathname == "/tickets"))) {
        let body = (await requestJson(request));
        if ((body !== null && typeof body === "object" && !Array.isArray(body))) {
            if (((typeof body.title === "string") && (body.title != ""))) {
                let ticket = { id: nextId, title: body.title, done: false };
                nextId += 1;
                tickets = append(tickets, ticket);
                return json(ticket, 201);
            }
        }
        return json({ error: "title is required" }, 400);
    }
    return notFound();
}
let port = parseNumber(env("PORT", "4321"));
print(`PlainScript API listening on http://localhost:${port}`);
(await serve(port, handler));
//# sourceMappingURL=server.js.map
