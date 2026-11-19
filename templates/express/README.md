# Express-compatible API starter

PlainScript calls the real `express` package through its JavaScript boundary; it does not
wrap or replace Express.

```bash
npm install
npm start
```

Then try `GET /health`, `GET /users/42` and `POST /echo` with a JSON body.

```bash
npm run check
```

Request and response objects are typed `any` at the framework boundary. Convert them to
PlainScript records before using application logic, as a normal Express codebase would.
