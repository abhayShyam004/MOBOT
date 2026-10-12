# MOBOT — GENERAL-PURPOSE TERMINAL/COMPUTER AGENT CAPABILITY EXPANSION

## CONTEXT

The current App Builder/full-stack work exposed an important misunderstanding in the architecture.

Full-stack development is NOT the actual product requirement.

Django, Node, React, databases, Vercel, Render, etc. are merely examples that can be used to test whether MOBOT has sufficient real-world execution capabilities.

The actual goal is much broader:

> MOBOT should be capable of performing essentially any legitimate task that a capable modern agentic AI could normally perform when given access to a terminal/computer, subject to the actual capabilities, permissions, hardware, network access, installed software, authentication state, and safety constraints of the Android device.

The phone should function as MOBOT's computer, terminal, filesystem, browser, execution environment, development environment, automation environment, and control surface.

Do NOT optimize the architecture around "full-stack development."

Treat full-stack development as ONE workload among many.

The target is GENERAL-PURPOSE AGENTIC COMPUTER CAPABILITY.

---

# 1. PRIMARY OBJECTIVE

Build MOBOT so that an agent is not artificially constrained to a small collection of predefined tools.

Instead, give the agent a coherent capability layer through which it can:

- inspect the device
- inspect and manipulate files
- execute commands
- install/use software where technically possible
- write and modify code
- run programs
- debug programs
- run tests
- inspect logs
- use the browser
- interact with websites
- download/upload files
- process documents
- process images
- process audio/video where supported
- create files and artifacts
- automate workflows
- use APIs
- make HTTP requests
- interact with local services
- start/stop/restart processes
- manage projects
- use Git
- build applications
- run development servers
- inspect databases
- perform migrations
- schedule work
- monitor processes
- recover from failures
- use Android device capabilities
- interact with other apps where permitted
- maintain state across turns
- reason about the environment
- discover capabilities dynamically
- combine multiple capabilities into arbitrary workflows.

The agent should be able to compose these primitives into tasks that were never explicitly anticipated by the MOBOT developers.

Do NOT create a giant hardcoded list of "things MOBOT can do."

Create a general capability substrate from which new tasks emerge naturally.

---

# 2. CORE DESIGN PRINCIPLE

The correct architecture is:

USER INTENT
    ↓
AGENT REASONING
    ↓
CAPABILITY DISCOVERY
    ↓
PLAN
    ↓
EXECUTION
    ↓
OBSERVATION
    ↓
ERROR DETECTION
    ↓
RECOVERY / ADAPTATION
    ↓
VERIFICATION
    ↓
RESULT

Not:

USER REQUEST
    ↓
MATCH REQUEST TO PREDEFINED FEATURE
    ↓
RUN SPECIAL CASE
    ↓
CLAIM SUCCESS

MOBOT must behave like a general-purpose computer agent.

---

# 3. TERMINAL-FIRST CAPABILITY

The terminal/execution environment is a foundational capability.

The agent must have a real execution interface capable of performing legitimate commands and receiving:

- stdout
- stderr
- exit code
- execution duration
- process state
- filesystem effects
- network effects where available
- generated files
- logs
- signals/process termination state.

The execution layer must support:

- commands
- arguments
- environment variables
- working directories
- stdin where appropriate
- stdout/stderr capture
- timeouts
- cancellation
- background processes
- detached processes
- process identification
- process lifecycle management
- port discovery
- signal/termination handling
- retries
- command chaining
- pipelines where supported
- shell scripts where supported.

Do not fake terminal execution through simulated responses.

If a command cannot actually execute, the agent must know that.

---

# 4. ENVIRONMENT DISCOVERY

Before attempting a task, MOBOT should be able to discover what the current environment actually provides.

Build a capability/environment discovery layer that can determine things such as:

### Runtime/software

- operating environment
- Android version/API
- CPU architecture
- available storage
- available memory
- installed runtimes
- installed interpreters
- installed compilers
- package managers
- available shells
- available binaries
- available SDKs
- available development tools
- available browsers
- available browser automation interfaces
- available databases
- available CLI tools
- available network utilities.

Examples:

- Python
- Node.js
- Java
- Kotlin
- Go
- Rust
- C/C++
- Git
- npm
- pnpm
- pip
- Gradle
- adb where available
- curl
- wget
- sqlite
- JavaScript runtimes
- image/document processing tools
- archive tools
- version-control tools.

Do NOT hardcode the assumption that these exist.

Discover them.

---

# 5. CAPABILITY REGISTRY

Create a general capability registry.

Each capability should describe at minimum:

- capability name
- description
- availability
- implementation/provider
- required permissions
- required runtime
- required binaries
- required network access
- authentication requirements
- device restrictions
- input schema
- output schema
- side effects
- safety classification
- verification method.

Examples:

```text
terminal.execute
filesystem.read
filesystem.write
filesystem.search
filesystem.move
filesystem.copy
filesystem.delete
process.start
process.stop
process.inspect
process.logs
network.http
network.download
network.upload
browser.open
browser.navigate
browser.click
browser.type
browser.extract
browser.screenshot
git.status
git.diff
git.commit
git.branch
runtime.detect
runtime.install
package.install
code.write
code.modify
code.test
database.inspect
database.query
database.migrate
document.read
document.write
image.inspect
image.generate
android.notification
android.clipboard
android.share
android.camera
android.screenshot
calendar.read
calendar.write
contacts.read
app.launch
app.interact
```

These are examples, not a fixed final list.
The architecture must allow new capabilities to be registered without redesigning the agent.

---

# 6. CAPABILITY DISCOVERY BY THE AGENT

The agent must be able to ask:
"What can I actually do in this environment?"

and receive an accurate answer.
For example:
If Python is unavailable:
DO NOT pretend Python exists.
Instead:
1. detect that Python is unavailable
2. determine whether it can legitimately be installed/provisioned
3. determine whether the device architecture/runtime supports it
4. attempt provisioning if supported
5. verify installation
6. retry the requested task
7. if impossible, explain the actual limitation.
The same principle applies to every runtime and dependency.

---

# 7. RUNTIME PROVISIONING

Where technically feasible, MOBOT should be able to provision project-specific execution environments.
Examples:
- Python environments
- Node environments
- Java environments
- project dependencies
- package dependencies
- SDK components
- CLI tools
- development servers
- database engines.
Prefer isolated environments.
Do not blindly modify the global Android environment.
Projects should be able to maintain their own dependencies and runtime configuration.
The agent should be able to perform:
DETECT
→ PROVISION
→ INSTALL
→ VERIFY
→ USE
rather than immediately giving up because something is missing.
If provisioning is impossible, report the actual reason.

---

# 8. FILESYSTEM AS A FIRST-CLASS CAPABILITY

The agent must be able to work with the filesystem as a real workspace.
It should be capable of:
- discovering files
- reading files
- writing files
- creating directories
- copying
- moving
- renaming
- deleting
- searching
- comparing
- patching
- inspecting metadata
- creating archives
- extracting archives
- tracking project state.
Large files must not unnecessarily be loaded entirely into model context.
Use streaming, ranges, search, indexing, or other appropriate mechanisms.

---

# 9. GENERAL SOFTWARE ENGINEERING

The agent should be able to perform arbitrary software-development workflows.
Not merely "build websites."
Examples include:
- create a project
- understand an existing project
- inspect architecture
- modify code
- refactor
- add features
- fix bugs
- install dependencies
- configure environments
- compile
- build
- run
- test
- debug
- inspect stack traces
- inspect logs
- benchmark
- profile where supported
- compare implementations
- use Git
- create branches
- inspect diffs
- revert changes
- maintain project state.
The agent should be able to discover the appropriate workflow for an unfamiliar project.
Do not require developers to explicitly implement a separate MOBOT feature for every framework.

---

# 10. GENERAL COMPUTER USE

MOBOT must not treat the terminal as the only way to interact with computers.
When appropriate, the agent should be able to combine:
TERMINAL
+
FILESYSTEM
+
BROWSER
+
ANDROID
+
NETWORK
+
DOCUMENTS
+
APPLICATIONS
into one workflow.
For example:
1. inspect a project with terminal
2. modify files
3. start a local server
4. open the server in Chrome
5. interact with the UI
6. observe errors
7. inspect logs
8. modify code
9. restart server
10. verify again
11. produce the final artifact.
The same pattern should work for completely unrelated tasks.

---

# 11. BROWSER / WEB AGENT CAPABILITY

Where browser access exists, the agent should be able to perform general browser workflows.
Capabilities should include where technically possible:
- open URL
- navigate
- inspect page
- click
- type
- scroll
- select
- submit forms
- download files
- upload files
- inspect page state
- extract structured information
- take screenshots
- handle multiple tabs/pages
- verify rendered applications
- interact with local development servers.
Browser state must be observable.
Do not report that a browser action succeeded merely because the command was issued.
Verify the resulting state.

---

# 12. NETWORK AND API CAPABILITIES

Where network access is available, the agent should be able to:
- make HTTP requests
- inspect responses
- download resources
- upload resources
- interact with APIs
- authenticate using supported mechanisms
- inspect HTTP failures
- retry appropriately
- parse JSON/XML/text responses
- save API results
- chain API operations.
Network availability must be detected rather than assumed.

---

# 13. DOCUMENT AND FILE INTELLIGENCE

The agent should be able to work with common file types where technically supported.
Examples:
- PDF
- DOCX
- XLSX
- CSV
- TXT
- Markdown
- JSON
- XML
- source code
- images
- archives.
Capabilities should include:
- inspect
- extract
- transform
- generate
- summarize
- search
- compare
- edit
- convert where supported.
A document should be treated as an object the agent can operate on, not merely text dumped into the conversation.

---

# 14. DATABASE CAPABILITY

Where a database is present or can legitimately be provisioned, the agent should be able to:
- discover the database
- inspect schema
- query
- modify data when authorized
- run migrations
- inspect errors
- seed data
- verify persistence
- test database-backed applications.
Again, Django/SQLite/PostgreSQL/etc. are examples.
The architecture must not be hardcoded around Django.

---

# 15. PROCESS AND SERVICE MANAGEMENT

Long-running processes are essential.
The agent must be able to:
- start
- stop
- restart
- inspect
- monitor
- collect logs from
- detect crashes
- detect hangs
- identify ports
- verify health
- recover services.
A process that existed for two seconds and died must NOT be reported as a working service.
The agent must distinguish:
CREATED
BUILT
STARTED
RUNNING
HEALTHY
UNHEALTHY
CRASHED
STOPPED
These are different states.

---

# 16. AUTONOMOUS ERROR RECOVERY

A capable agent should not stop at the first error.
Implement an execution loop:
OBSERVE
→ DIAGNOSE
→ MODIFY
→ RETRY
→ VERIFY
The agent should use:
- command output
- stack traces
- logs
- HTTP responses
- process state
- filesystem state
- screenshots
- test failures
- browser state
to determine what went wrong.
Do not endlessly retry the same failed operation.
Retries must be informed by new observations.

---

# 17. TASK PLANNING AND MULTI-STEP EXECUTION

The agent should be capable of decomposing complex requests into executable subtasks.
Example:
"Build X, test it, run it, verify it in Chrome, fix any issues, and give me the result."
should naturally become:
1. inspect environment
2. create workspace
3. implement
4. install dependencies
5. build
6. test
7. start
8. verify process
9. verify HTTP/UI state
10. diagnose failures
11. fix
12. restart
13. re-test
14. present result.
The agent should determine these steps dynamically.
Do not hardcode this exact sequence as the only workflow.

---

# 18. STATE AND MEMORY

Long-running tasks must preserve state.
The agent should know:
- what it created
- what it modified
- what processes are running
- where projects live
- which dependencies were installed
- what failed
- what was fixed
- what remains unresolved.
A new conversation turn must not cause the agent to forget the existence of a running project or previously created workspace.

---

# 19. USER APPROVAL AND SAFETY

General-purpose capability does NOT mean unrestricted behavior.
MOBOT must distinguish between:
- read-only actions
- reversible changes
- destructive actions
- external side effects
- credential use
- financial/important-account actions
- actions requiring explicit user authorization.
Use appropriate confirmation mechanisms.
Do not silently perform destructive or consequential actions merely because the terminal makes them technically possible.
But do not add pointless approval prompts to ordinary reversible development operations.
The objective is:
MINIMUM NECESSARY FRICTION
+
CORRECT SAFETY BOUNDARIES.

---

# 20. OBSERVABILITY

Every meaningful execution should be observable.
Expose enough information for the agent to know:
- what it attempted
- what actually happened
- why it failed
- what changed
- current state
- verification result.
Logs must be useful to both:
- the agent
- the human user.
Do not bury critical failures in tiny UI indicators.

---

# 21. TRUTHFULNESS REQUIREMENT

This is NON-NEGOTIABLE.
MOBOT must never claim:
- a command succeeded when it did not
- a server is running when it is not
- a file was created when it was not
- a test passed when it was not executed
- a deployment succeeded when it was not verified
- a browser page loaded when it did not
- a dependency exists when it does not
- a capability exists when it does not.
Every meaningful success claim must be backed by an actual observation.

---

# 22. CAPABILITY FALLBACK

When a requested operation cannot be performed directly, the agent should search for legitimate alternatives.
Example:
If tool A is unavailable:
1. inspect whether tool B can accomplish the same task
2. inspect whether the required runtime can be provisioned
3. inspect whether an API can accomplish it
4. inspect whether browser interaction can accomplish it
5. inspect whether another installed utility can accomplish it.
Do not immediately conclude:
"unsupported."
First determine whether another valid execution path exists.

---

# 23. NO SPECIAL-CASE ARCHITECTURE

Do NOT implement:
if user asks Django → Django system
if user asks React → React system
if user asks website → website system
if user asks PDF → PDF system
Instead implement reusable primitives:
EXECUTE
READ
WRITE
SEARCH
INSTALL
START
STOP
INSPECT
OBSERVE
INTERACT
TRANSFORM
VERIFY
Then allow the agent to compose them.
This is the architectural goal.

---

# 24. FULL-STACK AS A TEST, NOT THE PRODUCT

The existing full-stack/app-builder work should be preserved.
However, reframe it as a capability benchmark.
A request such as:
"Create a Django application, install dependencies, migrate the database, run it, open it in Chrome, test it, fix errors, and keep it running."
should test whether MOBOT can:
- detect Python
- provision Python if necessary
- install dependencies
- manipulate files
- execute commands
- run migrations
- start processes
- inspect ports
- interact with Chrome
- verify HTTP
- verify persistence
- diagnose errors
- modify code
- restart processes
- maintain state.
The important result is NOT:
"Django support works."
The important result is:
"MOBOT demonstrated general-purpose computer-agent capability."

---

# 25. CAPABILITY BENCHMARK SUITE

Create a general benchmark suite covering unrelated task categories.
At minimum test:
Terminal
- inspect environment
- create files
- manipulate files
- execute commands
- run scripts
- process output.
Software engineering
- create project
- modify existing project
- install dependency
- run tests
- diagnose failure
- fix failure.
Runtime management
- start service
- verify service
- kill service
- restart service
- recover from crash.
Browser
- open page
- interact with page
- extract information
- verify local application.
Network
- HTTP request
- download file
- API interaction.
Documents
- read
- transform
- generate.
Git
- inspect repository
- modify
- diff
- branch
- commit where authorized.
Database
- inspect
- query
- modify
- verify persistence.
Android
- use supported device capabilities
- interact with local files
- notifications
- clipboard
- screenshots
- camera/share/etc. where supported.
Complex autonomous workflow
A task requiring multiple unrelated capabilities chained together.
The benchmark should measure:
- task completion
- correctness
- verification
- recovery
- unnecessary user intervention
- false-success rate
- execution reliability.

---

# 26. PHYSICAL DEVICE VALIDATION

Everything must ultimately be validated on the actual Samsung Android device.
Do NOT accept:
"works on my development machine."
There is no development machine in the target architecture.
The target environment is:
PHONE
+
ANDROID
+
MOBOT
+
AVAILABLE NETWORK
+
AVAILABLE AUTHENTICATION
+
AVAILABLE RUNTIMES/TOOLS.
Every capability must be tested against that reality.

---

# 27. IMPORTANT DISTINCTION

Separate:
A. What the agent conceptually knows how to do
B. What the MOBOT execution layer can actually do
C. What the Android device currently permits
D. What software is currently installed
E. What can be provisioned
F. What requires user authorization
G. What is genuinely impossible in the current environment.
The agent must reason across these layers.

---

# 28. EXTENSIBILITY

Adding a new capability should ideally require:
1. implementing/registering the capability
2. defining its schema
3. defining its permissions
4. defining its verification
5. exposing it to capability discovery.
It should NOT require redesigning the agent planner.
The planner should operate over capabilities generically.

---

# 29. USER EXPERIENCE

The user should experience MOBOT as:
"Tell it what you want done."
not:
"First determine which MOBOT-specific feature supports your request."
The agent should handle the complexity.
The UI should surface:
- progress
- meaningful actions
- important questions
- errors
- verification
- generated artifacts
- running processes
- relevant links
- results.
Do not overwhelm the user with raw terminal output unless useful.

---

# 30. DO NOT REMOVE EXISTING CAPABILITIES

Preserve all existing working capabilities and user data.
Do not regress:
- existing bots
- threads
- providers
- authentication
- settings
- notifications
- skills
- structured responses
- Android integrations
- browser integrations
- existing execution infrastructure
- existing app-builder functionality.
Extend the architecture.
Do not perform unnecessary rewrites.

---

# 31. IMPLEMENTATION REQUIREMENT

First inspect the existing architecture thoroughly.
Identify:
- current terminal execution mechanism
- current Android computer capabilities
- current browser capabilities
- filesystem APIs
- process management
- runtime handling
- package/dependency handling
- agent tool registry
- tool invocation layer
- approval system
- state persistence
- project/workspace system
- error handling
- verification mechanisms.
Then identify architectural gaps.
Do NOT immediately start writing code.
Produce an implementation plan based on the existing architecture.
After implementation, run:
1. static checks
2. unit tests
3. integration tests
4. capability tests
5. physical Samsung tests
6. autonomous multi-step tests
7. failure/recovery tests.

---

# 32. CRITICAL ACCEPTANCE TEST

The following is a representative test, NOT the only target.
Give MOBOT an unfamiliar task such as:
"Create a small application using technology X. Determine what you need, install/provision anything necessary, implement it, run it, test it, open it in the browser, verify that it works, fix anything that fails, and leave the final result accessible."
The technology X should vary.
Examples:
- Django
- Flask
- FastAPI
- Node
- Java
- Go
- Rust
- static HTML
- CLI application
- SQLite application
- API service.
MOBOT should not require a special hardcoded implementation for each.
The point is to test generality.

---

# 33. SECOND ACCEPTANCE TEST: NON-DEVELOPMENT TASK

Use an unrelated task.
For example:
"Find a set of files matching a condition, inspect their contents, transform them according to these rules, create a report, save the report, and show me the result."
This tests whether the underlying system is actually general-purpose rather than merely an app builder.

---

# 34. THIRD ACCEPTANCE TEST: FAILURE RECOVERY

Intentionally introduce a failure.
Examples:
- missing dependency
- incorrect port
- crashed process
- malformed configuration
- failing test
- invalid file
- unavailable runtime.
The agent must:
1. observe failure
2. identify cause
3. take corrective action
4. retry
5. verify success.
Do not hardcode the expected fix.

---

# 35. FOURTH ACCEPTANCE TEST: CAPABILITY DISCOVERY

Give the agent a task requiring a capability that is not explicitly named.
The agent must determine:
- what capability is needed
- whether it exists
- how to obtain it
- how to use it
- how to verify it.
This tests whether the architecture is truly general.

---

# 36. SUCCESS CRITERIA

This work is successful only if MOBOT demonstrates that the agent can operate over a broad, composable computer capability layer rather than a collection of narrow product features.
Minimum bar:
- real terminal execution
- real filesystem manipulation
- real process management
- real runtime discovery
- real dependency handling
- real browser interaction
- real network interaction where available
- real document/file manipulation
- real project/workspace management
- real error diagnosis
- real recovery
- real verification
- persistent task state
- capability discovery
- capability composition
- accurate reporting
- appropriate authorization
- physical Android validation.
Most importantly:
A new task should be solvable because the agent can COMPOSE existing capabilities, not because a developer previously added a special-case implementation for that exact task.

---

# 37. FINAL PRINCIPLE

Do not ask:
"Does MOBOT support Django?"
Ask:
"Can MOBOT give an agent the same practical class of computer interaction that a capable agentic AI normally gets from having a terminal, filesystem, browser, network, runtime environment, and computer-control tools?"
That is the target.
Full-stack development is merely one stress test.
The finished system should feel like:
AI
+
COMPUTER
+
TERMINAL
+
BROWSER
+
FILESYSTEM
+
RUNTIMES
+
TOOLS
+
PERSISTENT STATE
+
VERIFICATION
+
AUTONOMOUS RECOVERY
running directly on the Android device.
Do not declare success based on generated code.
Do not declare success based on tool invocation.
Do not declare success based on a process being started.
Declare success only after the requested outcome has actually been observed and verified.

### The important architectural shift

This also changes how you should judge future work.

If you ask:

> **“Build me a Django site.”**

and it succeeds, that's interesting.

If you ask:

> **“Take these 400 files, find every occurrence of X, modify them according to Y, run a validation script, package the results, and give me the archive.”**

and it succeeds, that's **far more important**.

If you ask:

> **“Figure out how to do X on this phone, install whatever legitimate tooling you need, perform it, recover from anything that breaks, and verify the final result.”**

and it succeeds without MOBOT having a prewritten `do_X()` feature, **that's the real milestone.**

The end goal is essentially **an agent with a computer**, rather than **an app that happens to contain an agent**. That's the distinction the previous prompt was missing.

---

# MOBOT — BUILD THE GENERAL-PURPOSE COMPUTER AGENT LAYER

## IMPORTANT: THIS IS AN IMPLEMENTATION TASK, NOT A FEATURE-LIST TASK

The previous App Builder/full-stack work exposed the real architectural requirement.

I do NOT primarily care whether MOBOT can build Django apps, React apps, Node apps, or any other particular type of software.

Those are tests.

The actual goal is:

> Turn MOBOT into a general-purpose agentic computer environment in which the AI can perform the kinds of tasks a capable terminal/computer-using agent normally performs, using the Android phone as its computer.

The agent should not need a developer to implement a special MOBOT feature every time a new kind of task appears.

Instead, the agent should receive powerful, composable primitives such as execution, filesystem access, process control, browser control, networking, environment discovery, artifact manipulation, and device capabilities, then reason and compose them itself.

Your job in this task is to BUILD THAT SYSTEM.

Do not merely document it.
Do not merely register hypothetical capabilities.
Do not create mock tools.
Do not create a giant list of unsupported features.

Inspect the existing MOBOT architecture, identify the actual execution bottlenecks, implement the missing infrastructure, integrate it with the agent, and verify it on the physical Android device.

---

# 1. FIRST: AUDIT THE EXISTING SYSTEM

Before changing code, inspect the existing implementation thoroughly.

Find the actual implementations for:

- agent/tool execution
- terminal/command execution
- shell invocation
- Android computer tools
- browser tools
- filesystem tools
- file storage
- process creation
- process supervision
- background processes
- detached processes
- port management
- HTTP access
- network access
- package/dependency installation
- runtime detection
- runtime provisioning
- project/workspace management
- authentication
- approval/consent
- tool registry
- tool schemas
- agent planning
- task state
- conversation persistence
- error handling
- logging
- verification
- structured UI responses.

Trace a real agent request from:

USER
→ MODEL
→ TOOL SELECTION
→ TOOL EXECUTION
→ RESULT
→ MODEL
→ NEXT ACTION

Understand exactly where the current implementation restricts the agent.

Do not guess.

Determine the real architectural limitations from the code.

At the end of this audit, explicitly identify:

1. what the agent can already do,
2. what it technically cannot do,
3. what it can do only through special-case implementations,
4. what execution infrastructure is missing,
5. what parts can be generalized instead of adding more special cases.

Do not rewrite working systems unnecessarily.

Preserve all existing user data, bots, chats, providers, authentication, skills, notifications, browser integrations, Android integrations, and existing functionality.

---

# 2. CHANGE THE ARCHITECTURAL GOAL

The execution architecture must be changed from:

"Agent has a collection of application-specific tools"

to:

"Agent has access to a general computer capability layer."

The agent must be able to discover and compose capabilities dynamically.

The architecture should become conceptually:

USER REQUEST
    ↓
AGENT
    ↓
UNDERSTAND TASK
    ↓
DISCOVER AVAILABLE CAPABILITIES
    ↓
FORM PLAN
    ↓
EXECUTE REAL ACTIONS
    ↓
OBSERVE REAL RESULTS
    ↓
DIAGNOSE PROBLEMS
    ↓
ADAPT PLAN
    ↓
EXECUTE AGAIN
    ↓
VERIFY OUTCOME
    ↓
REPORT RESULT

Implement the infrastructure required for this.

---

# 3. BUILD A REAL GENERAL EXECUTION LAYER

Create or refactor the execution layer so the agent has a reliable primitive for actually doing things.

It must support real execution where the Android environment permits it.

The execution layer should provide:

- command execution
- command arguments
- working directory
- environment variables
- stdin when needed
- stdout
- stderr
- exit status
- execution time
- timeout
- cancellation
- background execution
- detached execution
- process identity
- process inspection
- process termination
- process restart
- output streaming
- log retrieval.

Do not implement fake terminal output.

Do not tell the model that a command succeeded merely because a subprocess request was made.

Return actual execution results.

If execution fails, return the actual failure.

---

# 4. FIX THE PROCESS MODEL

Long-running processes are mandatory for a useful computer agent.

A process started by the agent must not accidentally die merely because the model turn ended.

Implement proper lifecycle management.

A managed process should have:

- unique process ID
- command
- working directory
- environment
- start time
- state
- PID if available
- stdout/stderr logs
- associated project/task
- associated ports
- health state.

Support:

START
→ INSPECT
→ MONITOR
→ STOP
→ RESTART

The system must distinguish:

CREATED
STARTING
RUNNING
HEALTHY
UNHEALTHY
CRASHED
STOPPING
STOPPED

Do not collapse all of these into "started."

If a process crashes, MOBOT must know that it crashed.

If it stays alive, MOBOT must know that it is alive.

---

# 5. BUILD ENVIRONMENT DISCOVERY

Implement actual environment discovery.

When the agent starts a task requiring external capabilities, it should be able to inspect the environment rather than guessing.

Build a reusable environment inspection mechanism.

It should determine things such as:

- Android version
- architecture
- available storage
- memory
- shell availability
- available commands
- installed runtimes
- installed package managers
- installed compilers
- installed SDKs
- installed development tools
- available browsers
- browser control availability
- network availability
- filesystem access
- executable search paths
- available databases
- available document-processing tools.

The important point:

DO NOT hardcode:

"Python exists."

Actually check.

DO NOT hardcode:

"Git exists."

Actually check.

DO NOT hardcode:

"curl exists."

Actually check.

DO NOT hardcode:

"Chrome is available."

Actually check.

Build this as reusable infrastructure that the agent can invoke whenever necessary.

---

# 6. BUILD A REAL CAPABILITY REGISTRY

Create a capability registry backed by actual implementations.

A capability is not valid merely because its name exists in a registry.

Every registered capability must point to:

- a real implementation
- its input schema
- its output schema
- availability detection
- permission requirements
- dependencies
- side effects
- verification logic.

Examples of actual capability classes include:

- command execution
- filesystem operations
- process management
- networking
- browser interaction
- Git
- runtime detection
- dependency installation
- document processing
- database operations
- Android device operations.

These are examples.

Do not create separate high-level "Django tool", "React tool", "website tool", "PDF website tool", etc. simply to satisfy the task.

The agent should be able to construct those workflows from lower-level capabilities.

---

# 7. MAKE CAPABILITIES DISCOVERABLE TO THE MODEL

The model must have a reliable way to determine:

"What tools/capabilities do I currently have?"

and:

"What is required for this task?"

Implement a capability-discovery interface that returns the CURRENT truth.

For example:

If Python exists:

REPORT PYTHON AVAILABLE.

If Python does not exist:

REPORT PYTHON UNAVAILABLE.

If Python can be provisioned:

REPORT THAT.

If Python cannot be provisioned:

REPORT THAT.

The model must never need to hallucinate the environment.

Capability discovery must happen from real device state.

---

# 8. BUILD GENERIC TOOL COMPOSITION

This is one of the most important parts.

Do not create an enormous number of specialized tools that each perform a complete workflow.

Instead, expose powerful primitives that the agent can combine.

For example, the agent should be capable of independently composing:

inspect filesystem
→ create directory
→ write files
→ detect runtime
→ install dependency
→ run command
→ inspect output
→ start process
→ inspect process
→ open browser
→ interact with browser
→ inspect result
→ diagnose failure
→ modify files
→ restart process
→ verify again.

Nothing in that sequence should require a special "build web application" feature.

Implement the primitives correctly and let the model compose them.

---

# 9. GENERALIZE THE CURRENT APP BUILDER

Do NOT throw away the current App Builder.

Instead, remove assumptions that the agent is specifically an application builder.

The current App Builder should become one consumer of the general execution system.

For example:

Current:

APP BUILDER
→ SPECIAL BUILD TOOL
→ SPECIAL PREVIEW TOOL
→ SPECIAL RUNTIME LOGIC

Desired:

APP BUILDER
→ GENERAL FILESYSTEM
→ GENERAL EXECUTION
→ GENERAL PROCESS MANAGEMENT
→ GENERAL NETWORKING
→ GENERAL BROWSER
→ GENERAL VERIFICATION

This means the existing full-stack functionality becomes stronger automatically because it is using the same underlying machinery.

---

# 10. RUNTIME AND DEPENDENCY HANDLING

When a task requires software that is not installed:

DO NOT immediately give up.

First:

1. detect what is missing
2. determine whether it can be provisioned
3. determine where it can be installed safely
4. create an isolated environment where appropriate
5. install it
6. verify that installation succeeded
7. expose the newly available capability to the agent
8. continue the task.

Examples include:

- Python
- Node
- Java
- package managers
- project dependencies
- CLI tools.

Do not globally mutate the Android environment unnecessarily.

Prefer project-local or isolated environments where practical.

If something genuinely cannot be installed or executed on the device, report the actual reason instead of pretending support exists.

---

# 11. BUILD REAL FILESYSTEM CONTROL

The agent needs to be able to work on real files, not merely produce code in chat.

Implement reliable filesystem operations for the areas MOBOT is allowed to access.

At minimum the underlying system should support:

- list
- inspect
- read
- search
- create
- write
- append
- modify
- patch
- copy
- move
- rename
- delete
- archive
- extract
- compare.

Large files should be handled efficiently.

Do not dump entire large files into model context unnecessarily.

Allow search, ranges, targeted reads, and streaming where appropriate.

---

# 12. BUILD REAL NETWORK CONTROL

Where Android/network permissions permit it, give the agent general network primitives.

Implement actual mechanisms for:

- HTTP requests
- downloads
- uploads
- API calls
- response inspection
- authentication where supported
- retry
- timeout
- saving remote data locally.

The agent should be able to discover whether network access is available.

Do not assume network connectivity.

---

# 13. BUILD GENERAL BROWSER CONTROL

The browser must become a general-purpose computer capability, not merely an App Builder preview mechanism.

Where the existing browser infrastructure permits it, expose reusable operations for:

- opening a URL
- navigating
- clicking
- typing
- scrolling
- selecting
- submitting
- reading page content
- extracting information
- screenshots
- downloads
- uploads
- inspecting resulting state.

The agent must observe the outcome of browser actions.

For example:

CLICK LOGIN

does NOT mean:

"login succeeded."

It means:

"click was issued."

The agent must inspect what happened next.

---

# 14. BUILD GENERAL DOCUMENT/ARTIFACT HANDLING

The agent should be able to create, inspect, transform, and save artifacts using actual tools.

Integrate this with the general execution layer rather than creating isolated one-off flows.

Examples:

- PDF
- DOCX
- XLSX
- CSV
- JSON
- Markdown
- source code
- archives
- images.

The important requirement is that the agent can discover and use the available capabilities rather than requiring a hardcoded workflow for every document type.

---

# 15. BUILD GENERAL DATABASE ACCESS

Where a database exists or can be used, provide general infrastructure for:

- discovering it
- inspecting schema
- querying
- modifying authorized data
- migrations
- seeding
- validation
- persistence checks.

Again:

DO NOT implement:

"Django database support"

as the architecture.

Implement:

"database/process/filesystem/runtime primitives"

so Django, Flask, Node, Java, or any other system can use them naturally.

---

# 16. BUILD ERROR OBSERVATION + RECOVERY

This must be implemented as a general loop, not special-case error handling.

Whenever an action fails:

1. capture the error
2. preserve the relevant output
3. identify the failed operation
4. expose the evidence to the agent
5. allow the agent to reason about the failure
6. let the agent modify the environment
7. retry
8. verify again.

The system must support iterative autonomous debugging.

Example:

COMMAND
→ ERROR
→ READ ERROR
→ INSPECT ENVIRONMENT
→ CHANGE FILE
→ RETRY
→ NEW ERROR
→ DIAGNOSE
→ FIX
→ RETRY
→ SUCCESS
→ VERIFY

Do not make the agent ask the user after every ordinary recoverable error.

---

# 17. BUILD VERIFICATION INTO EVERY IMPORTANT ACTION

Every execution primitive needs a way to determine whether it actually worked.

Examples:

After writing a file:
→ confirm it exists.

After installing a package:
→ confirm it can be imported/executed.

After starting a server:
→ confirm process exists.

After starting a web service:
→ confirm port is listening.

After HTTP startup:
→ make a real request.

After browser navigation:
→ inspect page state.

After database mutation:
→ query it again.

After Git operation:
→ inspect repository state.

After generating an artifact:
→ confirm artifact exists and is readable.

Build verification into the execution infrastructure.

Do not rely on the model blindly trusting command output.

---

# 18. BUILD TASK STATE

Implement persistent execution state.

The system should remember:

- active task
- workspace
- project
- processes
- ports
- installed dependencies
- generated artifacts
- previous actions
- failures
- fixes
- current state.

This state must survive model turns.

The agent should be able to continue a task instead of starting from zero every turn.

---

# 19. BUILD SAFE USER CONTROL

General-purpose capability does not mean unrestricted destructive behavior.

Implement a coherent policy layer that distinguishes:

- ordinary read operations
- reversible modifications
- potentially destructive actions
- sensitive data access
- external side effects
- credential/authentication actions.

Ask for confirmation only when genuinely required.

Do not spam the user with approvals for every command.

The goal is:

AUTONOMOUS WHEN SAFE
+
EXPLICIT WHEN NECESSARY.

---

# 20. MAKE THE AGENT USE THE SYSTEM

This is critical.

It is not enough to build infrastructure that the model technically could use.

Integrate it into the agent's actual tool/capability selection and planning system.

Update the system instructions/tool descriptions/agent orchestration so the model learns to:

1. inspect capabilities when necessary
2. inspect the environment
3. choose appropriate primitives
4. compose multiple tools
5. observe their output
6. adapt based on results
7. verify completion
8. continue until the requested outcome is actually achieved.

The agent should NOT default to merely generating instructions for the user.

It should perform the task itself whenever MOBOT has the required capability.

---

# 21. REMOVE FALSE "UNSUPPORTED" BEHAVIOR

Search the codebase for places where the agent prematurely gives up because a specific high-level feature is not explicitly implemented.

Replace this pattern where appropriate.

BAD:

"I cannot create a Django application because MOBOT does not have Django support."

BETTER:

"I need Python and Django. I will inspect whether Python is available."

Then:

DETECT
→ PROVISION IF POSSIBLE
→ INSTALL DEPENDENCIES
→ EXECUTE
→ VERIFY.

The system should only report a genuine limitation after actually determining that the required execution path is unavailable.

---

# 22. MAKE FULL-STACK A TEST OF THE SYSTEM

Once the general execution layer works, use the existing full-stack functionality as a stress test.

Test tasks such as:

"Create a Django application."

Then:

"Create a Python API."

Then:

"Create a Node application."

Then:

"Create a CLI application."

Then:

"Debug this broken repository."

Then:

"Modify these files and run the tests."

The important question is NOT:

"Did we implement Django support?"

The important question is:

"Did the agent independently discover what it needed, use the available computer capabilities, execute the work, recover from failures, and verify the result?"

---

# 23. ADD NON-DEVELOPMENT TESTS

Do not validate only coding tasks.

Create tests that require the same general capability layer for unrelated tasks.

Examples:

TASK A

Find a set of files meeting a condition, inspect them, transform them, and create a report.

TASK B

Download a document, inspect it, extract information, create a new artifact, and save it.

TASK C

Open a website, navigate through several pages, collect information, and produce a structured result.

TASK D

Inspect a local project, identify why it fails, fix it, run its tests, and report the verified result.

TASK E

Start a local service, detect that it fails, inspect logs, fix the problem, restart it, and verify that it is healthy.

These tasks should use the same generalized execution infrastructure.

---

# 24. TEST UNSEEN TASKS

Do not only test workflows that developers explicitly designed.

After the implementation, give the agent tasks that were NOT used during development.

The purpose is to determine whether the system is genuinely general.

A strong result looks like:

NEW TASK
→ AGENT IDENTIFIES REQUIRED CAPABILITIES
→ AGENT DISCOVERS AVAILABLE TOOLS
→ AGENT EXECUTES
→ AGENT ENCOUNTERS PROBLEM
→ AGENT DIAGNOSES IT
→ AGENT ADAPTS
→ AGENT COMPLETES
→ AGENT VERIFIES.

A weak result looks like:

NEW TASK
→ "There is no feature for that."

The second outcome means the architecture is still too specialized.

---

# 25. PHYSICAL DEVICE TESTING

All meaningful execution functionality must be tested on the actual Samsung Android device.

Do not accept desktop-only verification.

The target environment is:

Samsung phone
+
Android
+
MOBOT
+
actual network state
+
actual installed software
+
actual permissions
+
actual available runtimes.

Do not claim capability based on development-machine behavior.

---

# 26. FAILURE-INJECTION TESTS

Intentionally break things.

Examples:

- remove a dependency
- stop a process
- give an invalid command
- introduce a code error
- use a wrong port
- corrupt a configuration
- cause a test failure
- make a service crash.

Then verify that MOBOT can observe and recover.

This is necessary because an agent that works only on the happy path is basically a fancy autocomplete box with delusions of grandeur.

---

# 27. DO NOT FAKE ANYTHING

Do NOT implement simulated:

- terminal execution
- process state
- browser state
- server state
- test results
- runtime availability
- package installation
- deployment
- file creation
- success status.

Do not manufacture successful results to satisfy tests.

If the environment prevents something from working, record the actual limitation.

---

# 28. TEST REQUIREMENTS

Add proper automated tests for:

- command execution
- command failures
- timeouts
- cancellation
- process lifecycle
- detached processes
- process crash detection
- environment detection
- capability discovery
- filesystem operations
- network operations
- browser state
- verification
- task persistence
- recovery
- permission/approval behavior.

Then run the relevant existing test suites.

Then perform physical-device validation.

---

# 29. REQUIRED IMPLEMENTATION PROCESS

Do this in the following order:

PHASE 1
Audit the existing execution/tool architecture.

PHASE 2
Identify the minimum architectural changes required to make it general-purpose.

PHASE 3
Implement the generalized execution substrate.

PHASE 4
Implement environment/capability discovery.

PHASE 5
Implement robust process lifecycle management.

PHASE 6
Integrate filesystem/network/browser/device capabilities.

PHASE 7
Integrate the system with the actual agent planner/tool-selection layer.

PHASE 8
Implement observation, verification, and recovery loops.

PHASE 9
Run automated tests.

PHASE 10
Run physical Samsung tests.

PHASE 11
Run unseen multi-step tasks.

PHASE 12
Fix every failure found.

PHASE 13
Run regression testing against all existing MOBOT functionality.

Do not stop after writing the first implementation.

---

# 30. REQUIRED FINAL REPORT

When finished, report:

### IMPLEMENTED

Exactly what infrastructure was added or changed.

### ARCHITECTURE

How the agent now discovers and composes capabilities.

### EXISTING CAPABILITIES

What the physical Android environment currently provides.

### NEW CAPABILITIES

What MOBOT can now actually execute that it could not before.

### LIMITATIONS

Anything genuinely impossible or unavailable on the current Android environment.

### TESTS

Exact automated test counts and results.

### PHYSICAL TESTS

Exact real-device workflows executed and whether they succeeded.

### FAILURE RECOVERY

At least several intentionally broken workflows and whether MOBOT recovered.

### UNSEEN TASKS

Tasks that were not hardcoded into the implementation and were successfully completed.

### REGRESSIONS

Anything existing that broke and how it was fixed.

Do not write "implemented" for functionality that was only scaffolded.

Do not write "supported" for functionality that was not physically verified.

---

# 31. DEFINITION OF DONE

This task is NOT complete because:

- a capability registry exists
- a few tools were added
- documentation was written
- the model was given longer system instructions
- full-stack demos work
- commands can be generated in chat.

This task is complete when:

1. The agent can discover what execution capabilities actually exist.

2. The agent can invoke real execution primitives.

3. Those primitives return real observations.

4. Processes can survive beyond a single model turn when required.

5. The agent can inspect and manipulate real files.

6. The agent can discover and use available runtimes/tools.

7. The agent can install/provision dependencies where technically feasible.

8. The agent can interact with the browser where available.

9. The agent can interact with network resources where permitted.

10. The agent can compose multiple primitives into unfamiliar workflows.

11. The agent can detect failures.

12. The agent can reason from actual failures and attempt fixes.

13. The agent can verify its own claimed results.

14. Task state survives across model turns.

15. Existing MOBOT functionality remains intact.

16. The system has been physically tested on the Samsung device.

17. Unseen tasks demonstrate that the system is general rather than a collection of hardcoded workflows.

---

# FINAL DIRECTIVE

Do not build "support for everything."

Build the underlying computer.

The objective is not:

"Add 100 more tools."

The objective is:

"Give the agent enough real, composable access to the computer that it can figure out how to accomplish new tasks itself."

Treat terminal execution, filesystem, processes, browser, networking, runtimes, artifacts, Android capabilities, observation, verification, and recovery as the fundamental substrate.

The agent should then be able to build workflows on top of that substrate without MOBOT developers having to predict every future use case.

START BY AUDITING THE EXISTING CODEBASE.

THEN IMPLEMENT THE GENERAL EXECUTION SUBSTRATE.

DO NOT STOP AT THE PLAN.

DO NOT JUST REPORT WHAT SHOULD EXIST.

MAKE THE CHANGES, TEST THEM, RUN THEM ON THE PHYSICAL DEVICE, FIX FAILURES, AND REPORT ONLY WHAT WAS ACTUALLY VERIFIED.
