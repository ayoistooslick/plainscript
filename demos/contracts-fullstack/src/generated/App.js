import { createElement, useEffect, useState } from "react";
import { ListTasks, CreateTask, ToggleTask, GetTask } from "./shared.js";
import { createClient, createFallibleClient } from "../../../../stdlib/contract.js";
import { append, count } from "../../../../stdlib/list.js";
let token = "";
async function login() {
    let response = (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "plainscript-demo" }) }));
    if ((!response.ok)) {
        return false;
    }
    let payload = (await response.json());
    token = payload.token;
    return true;
}
async function transport(name, input) {
    let path = "/api/tasks";
    let method = "GET";
    if ((name == "tasks.create")) {
        method = "POST";
    }
    if ((name == "tasks.toggle")) {
        path = "/api/tasks/toggle";
        method = "POST";
    }
    let requestBody = null;
    if ((method != "GET")) {
        requestBody = JSON.stringify(input);
    }
    let response = (await fetch(path, { method: method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: requestBody }));
    if ((!response.ok)) {
        throw `Request failed: ${response.status}`;
    }
    return (await response.json());
}
let listTasks = createClient(ListTasks, transport);
let createTask = createClient(CreateTask, transport);
let toggleTask = createClient(ToggleTask, transport);
let getTask = createFallibleClient(GetTask, transport);
function taskRows(tasks, onToggle) {
    let rows = [];
    for (const task of tasks) {
        let label = "Open";
        if (task.done) {
            label = "Done";
        }
        rows = append(rows, createElement("li", { className: "task", key: task.id }, createElement("button", { className: "toggle", onClick: () => (onToggle(task.id)) }, `${label}`), createElement("span", { className: "task-title" }, `${task.title}`)));
    }
    return rows;
}
export function App() {
    let [tasks, setTasks] = useState([]);
    let [draft, setDraft] = useState("");
    let [message, setMessage] = useState("Loading from SQLite…");
    async function refresh() {
        if ((token == "")) {
            let authenticated = (await login());
            if ((!authenticated)) {
                setMessage("Demo login failed");
                return null;
            }
        }
        try {
            let current = (await listTasks({  }));
            setTasks(current);
            setMessage("Saved in SQLite");
            if ((count(current) > 0)) {
                let checked = (await getTask({ id: ((current[0])?.id ?? 0) }));
                {
                    const $match1 = checked;
                    $arm1: {
                        if ($match1 !== null && typeof $match1 === "object" && $match1.$kind === "Success") {
                            const value = $match1["value"];
                            setMessage(`Verified ${value.title}`);
                            break $arm1;
                        }
                        if ($match1 !== null && typeof $match1 === "object" && $match1.$kind === "Failure") {
                            const error = $match1["error"];
                            setMessage(`Contract error: ${error.code}`);
                            break $arm1;
                        }
                    }
                }
            }
        } catch (failure) {
            setMessage("Could not load tasks");
        }
    }
    async function add() {
        try {
            let created = (await createTask({ title: draft }));
            setTasks(append(tasks, created));
            setDraft("");
            setMessage("Task saved");
        } catch (failure) {
            setMessage("Title is required");
        }
    }
    async function toggle(id) {
        try {
            let updated = (await toggleTask({ id: id }));
            let next = [];
            for (const task of tasks) {
                if ((task.id == updated.id)) {
                    next = append(next, updated);
                } else {
                    next = append(next, task);
                }
            }
            setTasks(next);
        } catch (failure) {
            setMessage("Could not update task");
        }
    }
    useEffect(() => (refresh()), []);
    return createElement("main", { className: "app" }, createElement("header", null, createElement("p", { className: "eyebrow" }, "PLAINScript / CONTRACTS"), createElement("h1", null, "One schema. Three layers."), createElement("p", { className: "lead" }, "Typed operations connect React to validated SQLite-backed handlers.")), createElement("form", { onSubmit: (event) => {
    event.preventDefault();
    add();
} }, createElement("input", { value: draft, placeholder: "A task worth finishing…", onChange: (event) => (setDraft(event.target.value)) }), createElement("button", { type: "submit" }, "Add task")), createElement("p", { className: "status" }, `${message} · ${count(tasks)} tasks`), createElement("ul", { className: "tasks" }, ...taskRows(tasks, toggle)), createElement("footer", null, "Input and output types are inferred from the shared runtime schemas."));
}
//# sourceMappingURL=App.js.map
