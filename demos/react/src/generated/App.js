import { createElement, useState } from "react";
import { append, count } from "../../../../stdlib/list.js";
export function App() {
    let [items, setItems] = useState([]);
    let [draft, setDraft] = useState("");
    function add() {
        if ((draft != "")) {
            setItems(append(items, { id: Date.now(), title: draft, done: false }));
            setDraft("");
        }
    }
    function toggle(id) {
        let next = [];
        for (const item of items) {
            if ((item.id == id)) {
                next = append(next, { id: item.id, title: item.title, done: (!item.done) });
            } else {
                next = append(next, item);
            }
        }
        setItems(next);
    }
    function submit(event) {
        event.preventDefault();
        add();
    }
    function rows() {
        let built = [];
        for (const item of items) {
            built = append(built, createElement("li", { key: item.id, className: "row", onClick: () => (toggle(item.id)) }, createElement("span", { className: "title" }, `${item.title}`), createElement("span", { className: "state" }, `${stateLabel(item)}`)));
        }
        return built;
    }
    let remaining = count(items);
    return createElement("main", { className: "app" }, createElement("h1", null, "PlainScript + React"), createElement("p", { className: "muted" }, `${remaining} item(s)`), createElement("form", { onSubmit: submit }, createElement("input", { value: draft, placeholder: "What needs doing?", onChange: (event) => (setDraft(event.target.value)) }), createElement("button", { type: "submit" }, "Add")), createElement("ul", null, ...rows()));
}
function stateLabel(item) {
    if (item.done) {
        return "done";
    }
    return "open";
}
//# sourceMappingURL=App.js.map
