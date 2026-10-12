/*
 * ombexec — the generic PATH launcher for MOBOT's Android runtime.
 *
 * The problem it solves is a platform rule, not a preference. Android refuses
 * to execve a file in the app's own data directory (the app's
 * `app_data_file` SELinux context): a 0755 shell script in the bot's bin
 * directory runs when a shell *reads* it, and answers EACCES the moment
 * anything tries to really execute it — `sh -c 'npx …'`, a Node
 * child_process.spawn, a nohup'd job, or a PTY session. `node` never had that
 * problem because it is a symlink into the APK's native library directory,
 * which Android *does* allow to be executed.
 *
 * This program is a second such target: a real ELF executable that Android
 * extracts into that same native library directory (as `libombexec.so`, the
 * only file name the package manager will extract from `lib/<abi>/`), so a
 * symlink from the bot's bin directory to it inherits node's permission to
 * run. It takes the name it was invoked as, resolves that name to a JavaScript
 * entry point, and execs the embedded Node runtime on it. Nothing about it
 * knows what npm, npx, or any particular package is: the mapping is data
 * (`OMB_LAUNCHER_<NAME>`, or the built-in npm/npx entries that point at the
 * paths the harness already exports), and any other tool can be added by
 * exporting one more variable — or by pointing a variable at another native
 * program entirely.
 *
 * It deliberately does the same job the shell wrappers did, so that the
 * wrappers and this launcher can coexist: PATH keeps a single entry per name,
 * and switching between them changes nothing observable to a caller.
 *
 * Errors are a single honest line on stderr and exit 127, the same failure a
 * shell reports for a command it cannot run.
 */
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_ARGS 512

static const char* base_name(const char* path) {
    const char* slash = strrchr(path, '/');
    return slash == NULL ? path : slash + 1;
}

/** Directory containing [path], or 0 when it has none. */
static int dir_of(const char* path, char* out, size_t size) {
    const char* slash = strrchr(path, '/');
    if (slash == NULL || slash == path) return 0;
    size_t len = (size_t)(slash - path);
    if (len + 1 > size) return 0;
    memcpy(out, path, len);
    out[len] = '\0';
    return 1;
}

/** Join a directory and a file name, refusing to truncate: a silently cut
 *  path would exec something else, or nothing. */
static int join_path(char* out, size_t size, const char* dir, const char* name) {
    int written = snprintf(out, size, "%s/%s", dir, name);
    return written > 0 && (size_t)written < size;
}

static int is_executable(const char* path) {
    return path != NULL && path[0] != '\0' && access(path, X_OK) == 0;
}

/** Look for `node` on PATH — the last resort when no native runtime path is
 *  derivable from this executable's own location. */
static int find_on_path(const char* name, char* out, size_t size) {
    const char* path = getenv("PATH");
    if (path == NULL) return 0;
    char buffer[PATH_MAX];
    snprintf(buffer, sizeof buffer, "%s", path);
    char* save = NULL;
    for (char* dir = strtok_r(buffer, ":", &save); dir != NULL; dir = strtok_r(NULL, ":", &save)) {
        if (dir[0] == '\0') continue;
        char candidate[PATH_MAX];            if (!join_path(candidate, sizeof candidate, dir, name)) continue;
        if (is_executable(candidate)) {
            snprintf(out, size, "%s", candidate);
            return 1;
        }
    }
    return 0;
}

/** `npx` → `OMB_LAUNCHER_NPX`; the name a caller chooses is the name it
 *  exports, so adding a tool needs no rebuild. */
static const char* launcher_env_name(const char* name, char* out, size_t size) {
    size_t at = 0;
    const char* prefix = "OMB_LAUNCHER_";
    for (size_t i = 0; prefix[i] != '\0' && at + 1 < size; i++) out[at++] = prefix[i];
    for (size_t i = 0; name[i] != '\0' && at + 1 < size; i++) {
        char c = name[i];
        if ((c >= 'a' && c <= 'z')) c = (char)(c - 32);
        else if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) c = '_';
        out[at++] = c;
    }
    out[at] = '\0';
    return out;
}

int main(int argc, char** argv) {
    const char* name = base_name(argv[0]);

    /* 1. Where is the runtime? Its own location is authoritative: the package
     *    manager put every native file in one directory. */
    char runtime[PATH_MAX] = "";
    char self[PATH_MAX];
    ssize_t got = readlink("/proc/self/exe", self, sizeof self - 1);
    if (got > 0) {
        self[got] = '\0';
        char dir[PATH_MAX];
        if (dir_of(self, dir, sizeof dir) && !join_path(runtime, sizeof runtime, dir, "libnode_host.so")) {
            runtime[0] = '\0';
        }
    }
    const char* override = getenv("OMB_NODE");
    if (override != NULL && override[0] != '\0') snprintf(runtime, sizeof runtime, "%s", override);
    if (!is_executable(runtime)) {
        if (!find_on_path("node", runtime, sizeof runtime)) {
            fprintf(stderr, "ombexec: the embedded runtime is missing (looked for libnode_host.so beside %s)\n", self);
            return 127;
        }
    }

    /* 2. What does this name mean? A caller-set mapping wins; npm and npx have
     *    built-in entries because the harness already exports their paths. */
    char envName[128];
    const char* target = getenv(launcher_env_name(name, envName, sizeof envName));
    if (target == NULL || target[0] == '\0') {
        if (strcmp(name, "npx") == 0) target = getenv("OMB_NPX_SHIM");
        else if (strcmp(name, "npm") == 0) target = getenv("OMB_NPM_CLI");
        else if (strcmp(name, "node") == 0) target = NULL; /* node execs itself */
    }
    if (strcmp(name, "node") == 0) {
        argv[0] = (char*)runtime;
        execv(runtime, argv);
        fprintf(stderr, "ombexec: could not run the embedded runtime: %s\n", strerror(errno));
        return 127;
    }
    if (target == NULL || target[0] == '\0') {
        fprintf(stderr, "ombexec: no launcher is configured for `%s`\n", name);
        return 127;
    }

    /* 3. The runtime's own libraries live beside it. A caller that inherited a
     *    stale or empty LD_LIBRARY_PATH still gets a runtime that can start. */
    char dir[PATH_MAX];
    if (dir_of(runtime, dir, sizeof dir)) {
        const char* existing = getenv("LD_LIBRARY_PATH");
        char joined[PATH_MAX * 2];
        if (existing == NULL || existing[0] == '\0') {
            snprintf(joined, sizeof joined, "%s", dir);
        } else {
            int written = snprintf(joined, sizeof joined, "%s:%s", dir, existing);
            if (written < 0 || (size_t)written >= sizeof joined) joined[0] = '\0';
        }
        if (joined[0] != '\0') setenv("LD_LIBRARY_PATH", joined, 1);
    }

    /* 4. A JavaScript entry point runs on the runtime; anything else is a
     *    program in its own right and is exec'd directly. */
    size_t targetLen = strlen(target);
    int isScript = (targetLen > 3 && strcmp(target + targetLen - 3, ".js") == 0)
        || (targetLen > 4 && strcmp(target + targetLen - 4, ".cjs") == 0)
        || (targetLen > 5 && strcmp(target + targetLen - 5, ".mjs") == 0);

    char* args[MAX_ARGS];
    size_t at = 0;
    size_t remaining = argc > 1 ? (size_t)(argc - 1) : 0;
    if (remaining > MAX_ARGS - 3) {
        fprintf(stderr, "ombexec: too many arguments\n");
        return 127;
    }
    if (isScript) {
        args[at++] = (char*)runtime;
        args[at++] = (char*)target;
        for (int i = 1; i < argc; i++) args[at++] = argv[i];
        args[at] = NULL;
        execv(runtime, args);
    } else {
        args[at++] = (char*)target;
        for (int i = 1; i < argc; i++) args[at++] = argv[i];
        args[at] = NULL;
        execv(target, args);
    }
    fprintf(stderr, "ombexec: could not run %s for `%s`: %s\n", target, name, strerror(errno));
    return 127;
}
