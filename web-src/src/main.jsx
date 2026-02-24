import { render } from "preact";
import { App } from "./App";
import "../styles/common.css";
import "../styles/task-popup.css";
import "../styles/list.css";
import "../styles/kanban.css";
import "../styles/process.css";
import "../styles/shell.css";

render(<App />, document.getElementById("app"));
