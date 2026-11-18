import { DatabaseSync } from "node:sqlite";
import { serve, json, notFound, urlOf, requestJson } from "../../../../stdlib/http.js";
import { print, env } from "../../../../stdlib/io.js";
import { parseNumber } from "../../../../stdlib/text.js";
import { append } from "../../../../stdlib/list.js";
import { ListTasks, CreateTask, ToggleTask } from "./shared.js";
import { implement } from "../../../../stdlib/contract.js";
let port = parseNumber(env("PORT", "4410"));
let databasePath = env("DB_PATH", "./tasks.db");
let database = new DatabaseSync(databasePath);
database.exec("create table if not exists tasks (id integer primary key autoincrement, title text not null, done integer not null default 0)");
let listStatement = database.prepare("select id, title, done from tasks order by id");
let getStatement = database.prepare("select id, title, done from tasks where id = ?");
let createStatement = database.prepare("insert into tasks (title, done) values (?, 0)");
let toggleStatement = database.prepare("update tasks set done = case done when 0 then 1 else 0 end where id = ?");
function rowTask(row) {
    return { id: row.id, title: row.title, done: (row.done == 1) };
}
async function listTasks(input) {
    let tasks = [];
    for (const row of listStatement.all()) {
        tasks = append(tasks, rowTask(row));
    }
    return tasks;
}
async function createTask(input) {
    let result = createStatement.run(input.title);
    for (const row of getStatement.all(result.lastInsertRowid)) {
        return rowTask(row);
    }
    return { id: 0, title: input.title, done: false };
}
async function toggleTask(input) {
    toggleStatement.run(input.id);
    for (const row of getStatement.all(input.id)) {
        return rowTask(row);
    }
    return { id: input.id, title: "missing", done: false };
}
async function authorize(context, input) {
    if ((context !== null && typeof context === "object" && !Array.isArray(context))) {
        let request = context["request"];
        if (true) {
            let header = request.headers.get("authorization");
            return (header == "Bearer plainscript-demo");
        }
    }
    return false;
}
let listEndpoint = implement(ListTasks, listTasks, { authorize: authorize });
let createEndpoint = implement(CreateTask, createTask, { authorize: authorize });
let toggleEndpoint = implement(ToggleTask, toggleTask, { authorize: authorize });
async function runOperation(endpoint, body, request) {
    try {
        let result = (await endpoint(body, { request: request }));
        return json(result);
    } catch (failure) {
        let error = failure;
        if ((error.stage == "authorization")) {
            return json({ error: "forbidden" }, 403);
        }
        if ((error.stage == "input validation")) {
            return json({ error: "invalid input", detail: error.message }, 400);
        }
        return json({ error: "operation failed", stage: error.stage }, 500);
    }
}
async function handler(request) {
    let url = urlOf(request);
    if (((request.method == "GET") && (url.pathname == "/api/tasks"))) {
        return (await runOperation(listEndpoint, {  }, request));
    }
    if (((request.method == "POST") && (url.pathname == "/api/tasks"))) {
        let body = (await requestJson(request));
        return (await runOperation(createEndpoint, body, request));
    }
    if (((request.method == "POST") && (url.pathname == "/api/tasks/toggle"))) {
        let body = (await requestJson(request));
        return (await runOperation(toggleEndpoint, body, request));
    }
    return notFound();
}
print(`PlainScript contracts demo API on http://localhost:${port}; SQLite database: ${databasePath}`);
(await serve(port, handler));
//# sourceMappingURL=server.js.map
