URGENT — FIX VEGA'S USER-FACING TOOL BEHAVIOR AND INTERACTIVE TERMINAL RUNTIME

I tested the actual Vega bot on the connected Android phone.

The user asked:

"install npx torlnk. if its installed open it"

Vega successfully discovered torlnk 1.9.0, but the resulting conversation is NOT acceptable for the standalone Android product.

The screenshot shows Vega exposing internal implementation/debug details to the user and eventually telling the user:

"To open it manually, run:
npx torlnk"

That is the wrong product behavior.

The phone IS the computer.

Do not solve this by requiring Termux, a desktop, a paired computer, root, or a manually operated external terminal.

==================================================
1. SEPARATE AGENT DIAGNOSTICS FROM USER-FACING RESPONSES
==================================================

The following must NEVER be dumped into normal user chat merely because a tool failed:

- agents_select_computer
- stopReason
- tool_error
- nohup
- shell prelude
- .omb-bin paths
- internal workspace paths
- raw subprocess errors
- internal tool names
- implementation details about the harness
- detailed recovery attempts

Those belong in:

- developer logs
- structured tool diagnostics
- debugging UI when explicitly requested
- internal telemetry

They do NOT belong in Vega's normal answer.

Vega should communicate the result naturally.

For example:

BAD:

"agents_select_computer failed because no configured computer or browser is available. nohup npx failed because npx is a shell function..."

GOOD:

"I found torlnk 1.9.0, but I can't open its interactive interface yet because this Android build doesn't currently have a persistent terminal session available."

That is enough.

==================================================
2. DO NOT TELL THE USER TO RUN TERMINAL COMMANDS
==================================================

Do NOT produce:

"run npx torlnk"

as the solution when the application is supposed to be standalone.

The product requirement is:

Android phone
    ↓
OpenMausBot runtime
    ↓
tools
    ↓
terminal/computer/browser
    ↓
external program

The user should not have to leave the app to operate the system.

If a requested program is interactive, Vega should either:

A. open it in the app's persistent terminal/computer UI,

OR

B. explain that the current Android build does not yet expose a persistent interactive session and stop cleanly.

Do not pretend that a one-shot command execution is equivalent to an interactive terminal.

==================================================
3. IMPLEMENT A REAL PERSISTENT TERMINAL SESSION IF THE PRODUCT CLAIMS TERMINAL SUPPORT
==================================================

Audit the current Android computer/terminal architecture.

Determine whether the app already has:

- shell execution
- terminal panel
- persistent process sessions
- PTY support
- stdin/stdout streaming
- process lifecycle management
- session IDs
- reconnect/resume
- foreground/background handling

A TUI such as torlnk cannot be treated as a normal:

exec(command)
→ wait
→ collect stdout
→ exit

operation.

It requires:

PTY
+
persistent process
+
stdin
+
stdout/stderr streaming
+
terminal dimensions
+
session lifecycle

If the product already has a terminal panel, connect interactive processes to that existing terminal.

If it does not, determine the smallest architecture-consistent way to provide one.

Do NOT introduce a second unrelated terminal architecture if an existing computer/terminal subsystem already exists.

==================================================
4. FIX THE npx / npm EXECUTABLE PROBLEM
==================================================

The investigation found:

npx works inside the shell prelude,

but:

nohup npx ...
sh -c "npx ..."
nested subprocesses

cannot find npx because the current npx is a shell function rather than an actual executable.

This is a runtime defect.

Fix the Android Node environment so npm/npx can be invoked by subprocesses as real executables.

Do not simply special-case torlnk.

Verify:

which node
which npm
which npx

from:

- normal bot shell
- spawned subprocess
- background process
- persistent terminal session

The same runtime environment must be available consistently.

Do not create fake wrappers that only work for one command.

Use the bundled Node/npm installation already used by OpenMausBot.

==================================================
5. FIX THE SEMANTICS OF "INSTALLED"
==================================================

Do not tell the user:

"torlnk is installed"

merely because:

npx --yes torlnk --help

successfully downloaded/executed the package.

Distinguish:

NOT PRESENT

AVAILABLE THROUGH npx

INSTALLED LOCALLY

RUNNING

INTERACTIVE SESSION ACTIVE

For example:

"torlnk is available through npx (v1.9.0), but it isn't currently running."

Only call something installed if the runtime can actually establish that it is installed according to the project's package/runtime semantics.

==================================================
6. TOOL RESULT → NATURAL USER RESPONSE
==================================================

Introduce/verify a clean separation:

TOOL EXECUTION LAYER
    ↓
structured result
    ↓
agent reasoning
    ↓
natural user response

The agent should receive structured information such as:

{
  "success": false,
  "reason": "interactive_session_unavailable",
  "package": "torlnk",
  "version": "1.9.0",
  "runtime": "node",
  "interactive": true
}

It should NOT have to expose the raw implementation details.

==================================================
7. HANDLE INTERACTIVE PROGRAMS EXPLICITLY
==================================================

Add an explicit capability classification for commands/programs:

- non_interactive
- interactive
- graphical
- background_service

For an interactive command:

If terminal session exists:

→ launch it into the terminal session.

If terminal session doesn't exist but can be created:

→ create one and attach the process.

If neither exists:

→ tell the user clearly that interactive terminal support is currently unavailable.

Do NOT:

→ attempt random computer selection
→ attempt nohup
→ attempt arbitrary background execution
→ dump all failures into chat
→ tell the user to leave the app

==================================================
8. COMPUTER TOOL ERROR HANDLING
==================================================

The screenshot shows:

agents_select_computer Error

followed by:

error: One or more tool operations failed...

The UI should not turn every internal tool failure into a scary red diagnostic underneath an otherwise successful natural-language answer.

Create a distinction between:

USER-ACTIONABLE FAILURE

and

INTERNAL TOOL FAILURE.

For example:

USER-ACTIONABLE:

"I found torlnk, but I can't open its interactive interface because no terminal session is available."

INTERNAL:

"log tool failure internally"

The chat should not contain the internal error unless the user explicitly asks to see diagnostics.

==================================================
9. DO NOT HIDE REAL FAILURES
==================================================

Do not solve this by simply suppressing the red error.

The underlying turn currently ends:

ok=false
stopReason=tool_error

Determine whether the requested task actually succeeded.

If the user requested:

"open torlnk"

and torlnk was not actually opened,

the turn must NOT claim success.

Instead:

"I found torlnk 1.9.0, but I couldn't open its interactive interface because this Android build currently has no persistent terminal session."

That is honest and useful.

==================================================
10. TORLNK END-TO-END TEST
==================================================

On the real ARM64 phone:

1. Ask Vega:

   "check whether torlnk is available"

2. Verify the answer doesn't expose internal diagnostics.

3. Ask:

   "install torlnk if necessary"

4. Verify availability/install semantics.

5. Ask:

   "open torlnk"

6. If persistent terminal support exists:
   verify torlnk actually launches inside the app.

7. Verify the TUI receives terminal dimensions.

8. Verify stdin reaches the process.

9. Verify stdout/stderr streams back into the terminal UI.

10. Verify the session remains alive after the original bot turn completes.

11. Verify the user can interact with it.

12. Verify closing the terminal/session terminates the process cleanly.

If the app does NOT currently support interactive terminals:

prove that clearly and make Vega report the limitation honestly rather than pretending to open it.

==================================================
11. GENERALIZE THIS BEYOND TORLNK
==================================================

Do not hardcode torlnk.

Test at least one other genuinely interactive CLI/TUI program.

The architecture must work for arbitrary interactive programs.

The point is not "make torlnk work."

The point is:

OpenMausBot Android must correctly distinguish:

ONE-SHOT COMMAND

from

PERSISTENT INTERACTIVE PROCESS.

==================================================
12. REGRESSION TESTS
==================================================

Add automated tests for:

- npx executable discovery
- npm executable discovery
- nested subprocess environment
- background subprocess environment
- interactive command classification
- persistent terminal creation
- stdin streaming
- stdout streaming
- process lifecycle
- terminal resize
- session cleanup
- failed interactive-session creation
- user-facing error translation
- internal error isolation
- "installed" vs "available through npx"
- successful non-interactive commands
- failed commands

Add a regression test proving that:

npx works inside a bot shell

AND

npx works when spawned as a real child process.

==================================================
13. IMPORTANT PRODUCT RULE
==================================================

Never confuse:

"the runtime can execute a command"

with:

"the application provides a computer capable of interactively operating that program."

And never confuse:

"the tool failed internally"

with:

"the user needs to know our internal implementation details."

The final user experience should be:

User:
"install npx torlnk. if it's installed open it"

Vega:

"I found torlnk 1.9.0. It's available through npx, but its interactive interface requires a persistent terminal session.

[Open Terminal]"

If the terminal exists, launch it.

If it doesn't:

"I found torlnk 1.9.0, but this Android build doesn't currently have a persistent terminal session for interactive programs. I haven't opened it."

No raw stack traces.
No tool names.
No nohup discussion.
No .omb-bin paths.
No "run this command manually."
No pretending the task succeeded.

==================================================
FINAL REPORT
==================================================

Report separately:

1. What was wrong.
2. Whether npx/npm are now real subprocess-accessible executables.
3. Whether persistent interactive terminal support exists.
4. Whether torlnk can actually be opened inside the Android app.
5. Whether stdin/stdout/session persistence works.
6. What changed.
7. Automated tests.
8. ARM64 physical-device tests.
9. Any remaining architectural limitation.

Do not mark this complete merely because torlnk --help works.

The acceptance criterion is actual end-to-end behavior inside the standalone Android application.
