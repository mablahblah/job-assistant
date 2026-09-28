---
paths: ["lib/services/**/*.ts"]
---

# Services

A service owns exactly one table or one row, and reaches the database only through the client it is built from.

- File: `lib/services/{subject}-service.ts`
- Type: `{Subject}Service`
- Builder: `create{Subject}Service(db)`
- A shared stand-in: `fake{Subject}Service()` in `lib/services/{subject}-service.fake.ts`
- A row it reads back: `{Subject}Record`
