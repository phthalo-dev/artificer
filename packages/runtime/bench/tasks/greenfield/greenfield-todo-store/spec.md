Build a small todo-list library in this scaffold. Implement `src/store.js` and `src/persistence.js` per their stub signatures — do not change the exported names or `src/index.js`.

Required behavior:

1. `TodoStore#addTodo(text)` creates a todo `{ id, text, completed: false }` with a unique auto-incrementing numeric `id`, and returns it. It must throw if `text` is empty or whitespace-only.
2. `TodoStore#completeTodo(id)` marks the matching todo's `completed` as `true`. It must throw if no todo has that `id`.
3. `TodoStore#removeTodo(id)` removes the matching todo from the store. It must throw if no todo has that `id`.
4. `TodoStore#listTodos(options)` returns an array of todos sorted by `id` ascending. By default (no options, or `{ includeCompleted: false }`) it excludes completed todos. With `{ includeCompleted: true }` it returns every todo, completed or not.
5. `saveToFile(filePath, store)` (in `src/persistence.js`) writes all of `store`'s todos (including completed ones) to `filePath` as JSON.
6. `loadFromFile(filePath)` reads a file written by `saveToFile` and returns a new `TodoStore` populated with the same todos, preserving each todo's `id`, `text`, and `completed` state.

Verify with `npm test` (runs `node --test tests/*.test.js` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
