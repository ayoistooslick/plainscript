import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./generated/App.js";
import "./style.css";

createRoot(document.getElementById("root")).render(createElement(App));
