import { createElement } from "react";
import { append } from "../../../../stdlib/list.js";
const features = [{ title: "Compiled ahead of time", detail: "PlainScript checks types, then emits plain ES modules." }, { title: "No JSX runtime", detail: "render blocks call createElement from the module scope." }, { title: "Next.js native", detail: "The output is an ordinary React component Next can render." }];
export function Home() {
    let cards = [];
    for (const feature of features) {
        cards = append(cards, createElement("li", { key: feature.title, className: "card" }, createElement("h2", null, `${feature.title}`), createElement("p", null, `${feature.detail}`)));
    }
    return createElement("main", { className: "page" }, createElement("h1", null, "PlainScript inside Next.js"), createElement("p", { className: "lead" }, "This page is a React Server Component compiled from PlainScript."), createElement("ul", { className: "grid" }, ...cards));
}
//# sourceMappingURL=Home.js.map
