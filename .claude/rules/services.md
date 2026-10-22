---
paths: ["lib/services/**/*.ts"]
---

# Services

A service writes to exactly one table or one row, and reaches the database only through the client it is built from, the database connection handed to its builder. It may read a linked table's columns in the same query as its own.

- File: `lib/services/{subject}-service.ts`
- Type: `{Subject}Service`
- Builder: `create{Subject}Service(db)`
- A shared stand-in: `fake{Subject}Service()` in `lib/services/{subject}-service.fake.ts`
- A row it reads back: `{Subject}Record`
