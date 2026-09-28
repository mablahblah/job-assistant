---
paths: ["lib/tools/**/*.ts"]
---

# Tools

A tool wraps one thing outside the app, such as a browser, a web server or a map service. It owns no table and takes no job list. One file holds one outside thing, and may offer it in more than one way.

- File: `lib/tools/{subject}.ts`, named for the thing it wraps
- A tool that keeps something open between calls, such as a browser or a server, is set up by a builder: a function starting with `create` that hands the tool back — `createResolutionBrowser()`. A tool offering its thing in more than one way has one builder per way — `createRenderedPageFetcher()`, `createRenderedPageBrowser()`.
- A tool that makes one request per call exports plain functions — `fetchPageAnswer()`
- The interface a tool satisfies, the list of functions it promises, sits in the tool's own file. It moves to a file of its own beside the tool when a stand-in or a second tool satisfies it too — `resolution-page.ts`.
- A shared stand-in is `fake{Subject}()` in `lib/tools/{subject}.fake.ts`
