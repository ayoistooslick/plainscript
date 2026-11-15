# PlainScript Commerce

A persistent catalogue, cart, and order API with inventory-safe checkout. The backend is PlainScript over SQLite; simulated payments are reported as simulated rather than presented as a real provider charge.

## Run

```bash
npm install
DB_PATH=./store.db npm start
# open http://localhost:3000
```

Endpoints include `GET /api/products`, `POST /api/products`, `POST /api/cart`, `GET /api/cart/:customerId`, `POST /api/checkout`, `GET /api/orders/:customerId`, and `GET /api/dashboard`. Checkout runs inside a SQLite transaction, validates stock, decrements inventory, and creates an order.

`src/app.pln` contains the domain logic and persistence, `src/client.pln` is the browser module, and `src/shared.pln` holds shared records. Real payment-provider credentials are not required or implied; the payment abstraction returns `simulated` status.

Commands: `npm run check`, `npm run build`, `npm start`.
