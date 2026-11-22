#!/usr/bin/env python3
"""Expose a Python module's functions over PlainScript's JSON-RPC bridge.

Usage:
    python3 src/interop/python_server.py path/to/service.py

Every public callable in the module becomes a method. The protocol is one JSON
object per line on stdin/stdout; `__manifest` lists the exported functions and
`__ping` is a health check. Results are JSON-encoded; exceptions become
JSON-RPC errors.

This file is plain Python with no dependencies, so it can be copied into a
Python project and used without installing PlainScript.
"""
from __future__ import annotations

import importlib.util
import inspect
import json
import sys
import traceback
from typing import Any, Callable


def load_module(path: str):
    spec = importlib.util.spec_from_file_location("plainscript_python_service", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Python module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def public_functions(module: Any) -> dict[str, Callable[..., Any]]:
    found: dict[str, Callable[..., Any]] = {}
    for name, value in vars(module).items():
        if name.startswith("_"):
            continue
        if inspect.isfunction(value) and value.__module__ == module.__name__:
            found[name] = value
    return found


def manifest(module: Any, functions: dict[str, Callable[..., Any]]) -> dict[str, Any]:
    described = []
    for name, function in sorted(functions.items()):
        signature = inspect.signature(function)
        parameters = []
        for parameter in signature.parameters.values():
            parameters.append({
                "name": parameter.name,
                "optional": parameter.default is not inspect.Parameter.empty,
                "rest": parameter.kind is inspect.Parameter.VAR_POSITIONAL,
                "type": {"kind": "any", "display": "any"},
            })
        described.append({"name": name, "async": inspect.iscoroutinefunction(function), "params": parameters,
                          "returns": {"kind": "any", "display": "any"}})
    return {
        "protocol": "plainscript-jsonrpc/1",
        "module": module.__name__,
        "entry": getattr(module, "__file__", None),
        "version": "python",
        "functions": described,
        "values": [],
    }


def run(path: str) -> int:
    try:
        module = load_module(path)
    except Exception as failure:  # pragma: no cover - startup failure path
        print(f"Cannot load {path}: {failure}", file=sys.stderr)
        return 2

    functions = public_functions(module)
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            method = request.get("method")
            if method == "__manifest":
                result: Any = manifest(module, functions)
            elif method == "__ping":
                result = {"ok": True, "module": module.__name__}
            elif method in functions:
                params = request.get("params") or []
                if isinstance(params, dict):
                    signature = inspect.signature(functions[method])
                    params = [params[name] for name in signature.parameters if name in params]
                result = functions[method](*params)
            else:
                raise LookupError(f"Unknown method {method!r}. Available: {', '.join(sorted(functions))}")
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except Exception as failure:
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32000, "message": str(failure),
                          "data": traceback.format_exc() if "--debug" in sys.argv else None},
            }
        sys.stdout.write(json.dumps(response, default=str) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print("usage: python_server.py <module.py> [--debug]", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(run(sys.argv[1]))
