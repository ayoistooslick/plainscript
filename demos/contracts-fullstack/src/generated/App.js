import { createElement, useEffect, useState } from "react";
import { ListTasks, CreateTask, ToggleTask } from "./shared.js";
import { createClient } from "../../../../stdlib/contract.js";
import { append, count } from "../../../../stdlib/list.js";
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
    let response = (await fetch(path, { method: method, headers: { "content-type": "application/json", authorization: "Bearer plainscript-demo" }, body: requestBody }));
    if ((!response.ok)) {
        throw `Request failed: ${response.status}`;
    }
    return (await response.json());
}
let listTasks = createClient(ListTasks, transport);
let createTask = createClient(CreateTask, transport);
let toggleTask = createClient(ToggleTask, transport);
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
        try {
            let current = (await listTasks({  }));
            setTasks(current);
            setMessage("Saved in SQLite");
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
