import { serve, json, notFound, urlOf, requestJson } from "../../../../stdlib/http.js";
import { print, env } from "../../../../stdlib/io.js";
import { parseNumber } from "../../../../stdlib/text.js";
import { count } from "../../../../stdlib/list.js";
import { open, table, migrate } from "../../../../stdlib/db.js";
import { hashPassword, verifyPassword, signToken, verifyToken, bearer } from "../../../../stdlib/auth.js";
import { ListTasks, CreateTask, ToggleTask, GetTask, TaskSchema } from "./shared.js";
import { implement, implementFallible, createClient, fallibleOperation, router, resultToWire, success, failure } from "../../../../stdlib/contract.js";
let port = parseNumber(env("PORT", "4410"));
let databasePath = env("DB_PATH", "./tasks.db");
let secret = env("AUTH_SECRET", "plainscript-contracts-development-secret");
let issuer = "plainscript-contracts-demo";
let audience = "tasks";
let database = (await open(databasePath));
(await migrate(database, [{ version: 1, name: "create tasks and users", up: async (db) => {
    db.exec("create table tasks (id integer primary key autoincrement, title text not null, done integer not null default 0)");
    db.exec("create table users (id integer primary key autoincrement, username text not null unique, password_hash text not null, role text not null)");
} }]));
let tasks = table(database, "tasks", TaskSchema);
let users = database.query("select id from users where username = ?", ["demo"]);
if ((count(users) == 0)) {
    let passwordHash = (await hashPassword("plainscript-demo"));
    database.run("insert into users (username, password_hash, role) values (?, ?, ?)", ["demo", passwordHash, "admin"]);
}
async function listTasks(input) {
    return tasks.list();
}
async function createTask(input) {
    return tasks.insert({ id: 0, title: input.title, done: false });
}
async function toggleTask(input) {
    let current = tasks.get(input.id);
    if ((current == null)) {
        return { id: input.id, title: "missing", done: false };
    }
    let row = current;
    return tasks.update(input.id, { id: row.id, title: row.title, done: (!row.done) });
}
async function getTask(input) {
    let current = tasks.get(input.id);
    if ((current == null)) {
        return failure({ code: "NOT_FOUND", message: `task ${input.id} does not exist` });
    }
    return success(current);
}
async function authorize(context, input) {
    if ((context !== null && typeof context === "object" && !Array.isArray(context))) {
        let user = context["user"];
        return (user != null);
    }
    return false;
}
let listEndpoint = implement(ListTasks, listTasks, { authorize: authorize });
let createEndpoint = implement(CreateTask, createTask, { authorize: authorize });
let toggleEndpoint = implement(ToggleTask, toggleTask, { authorize: authorize });
let getEndpoint = implementFallible(GetTask, getTask, { authorize: authorize });
let routes = router({ "tasks.list": listEndpoint, "tasks.create": createEndpoint, "tasks.toggle": toggleEndpoint });
let fallibleRoutes = router({ "tasks.get": getEndpoint });
async function runOperation(name, body, context) {
    try {
        let result = (await routes.handle(name, body, context));
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
function authUser(request) {
    let token = bearer(request);
    if ((token == null)) {
        return { authenticated: false };
    }
    let check = verifyToken(token, secret, { issuer: issuer, audience: audience });
    if ((!check.valid)) {
        return { authenticated: false };
    }
    return { authenticated: true, user: check.payload };
}
async function login(request) {
    try {
        let body = (await requestJson(request));
        let rows = database.query("select id, username, role, password_hash from users where username = ?", [body.username]);
        if ((count(rows) == 0)) {
            return json({ error: "invalid credentials" }, 401);
        }
        let user = rows[0];
        let valid = (await verifyPassword(body.password, user.password_hash));
        if ((!valid)) {
            return json({ error: "invalid credentials" }, 401);
        }
        let token = signToken({ sub: `${user.id}`, username: user.username, role: user.role }, secret, { expiresIn: 3600, issuer: issuer, audience: audience });
        return json({ token: token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (failure) {
        return json({ error: "invalid login request" }, 400);
    }
}
async function handler(request) {
    let url = urlOf(request);
    if (((request.method == "POST") && (url.pathname == "/api/auth/login"))) {
        return (await login(request));
    }
    let auth = authUser(request);
    if ((!auth.authenticated)) {
        return json({ error: "forbidden" }, 403);
    }
    let context = { request: request, user: auth.user };
    if (((request.method == "GET") && (url.pathname == "/api/tasks"))) {
        return (await runOperation("tasks.list", {  }, context));
    }
    if (((request.method == "POST") && (url.pathname == "/api/tasks"))) {
        let body = (await requestJson(request));
        return (await runOperation("tasks.create", body, context));
    }
    if (((request.method == "POST") && (url.pathname == "/api/tasks/toggle"))) {
        let body = (await requestJson(request));
        return (await runOperation("tasks.toggle", body, context));
    }
    if (((request.method == "POST") && (url.pathname == "/api/tasks/get"))) {
        let body = (await requestJson(request));
        let wire = resultToWire((await fallibleRoutes.handle("tasks.get", body, context)));
        if (wire.ok) {
            return json(wire);
        }
        let code = wire.error.code;
        if ((code == "NOT_FOUND")) {
            return json(wire, 404);
        }
        if ((code == "FORBIDDEN")) {
            return json(wire, 403);
        }
        return json(wire, 400);
    }
    return notFound();
}
print(`PlainScript contracts demo API on http://localhost:${port}; SQLite database: ${databasePath}`);
print("Demo login: demo / plainscript-demo (development credentials)");
(await serve(port, handler));
//# sourceMappingURL=server.js.map
