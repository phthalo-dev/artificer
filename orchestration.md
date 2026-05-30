1. The call hierarchy — what are the "levels"? e.g. is there a top-level coordinator that receives a message and spawns focused sub-calls? Are sub-calls nested arbitrarily deep, or fixed roles (planner → worker → reviewer, etc.)?

There are levels and some fixed roles and sub-calls can be nested arbitrarily deep. The top level communicator only deals with taking in messages from the outside and deciding what to do with that message. From there, there will be some fixed roles like

- orchestrator: owns the top level of projects/work and deals out work to smaller
- planner: coming up with the work to do, the output will be an artifact
- reviewer:
- worker

2. Units of work — what's the smallest unit an LLM call operates on? How does a result from a small call feed back up?

The smalles unit an LLM call can operate on is a single file. For example there might be a task to add a new component to a design system. The top level communicator will take that input and send it to a work orchestrator call, that will make sure it has the right repository cloned, and then passes along the information to a planner to create a plan and send it to a reviewer (work orchstrator done). The planner will create a plan and send it the reviewer, this will update the status of the project and send a message to the work orchestrator. The reviewer will review the plan, send any notes to the orchestrator who will update the status of the project and decide what to do next. When the plan is ready for implementation the orchestrator will send out worker calls to implement the different parts of the project. When those are done a reviewer reviews them, etc. After each call, the orchestrator is called with the result and decides if there is any new work to call. If the project is done successfully it can tell the top-level communicator.

Results feed back up when it completes its task. Each task will end by calling the workstream orchestrator, which will have the current status of all the work and decide if other smaller calls need to happen.

3. State between calls — what does each call "see"? (full history, a summary, just its task?) This matters a lot for the file-storage layout.

Each call can see its task and a summary. Each call also has the opportunity to query for things, such as other work/tasks in the workstream, memories,

4. Tools — what can the agent actually do (read/write files, run shell, git, HTTP)? Are tools available at all levels or only leaf calls?

Read/write files, run shell scripts, run git/github commands. The main tool the levels of LLMs can call is the orchistrator tool itself to query the current status of the system, and invoke new calls.

5. The "messaged like a person" surface — when a message arrives, does it always go to the top coordinator? Can the agent be "busy" working and queue/interrupt? Does it message back asynchronously?

The message should get sent to the top coordinator, which then decides what to do with it. For example it could kick off a new work stream "hey can you work on feature XYZ", it could be to get status of a specific workstream or in general "How is project Y doing?" the agent could have multiple workstreams going at the same time, it could be like asking a person a question "what do you think about Z", it could be to modify a current workstream "for project X make sure to do Y"
