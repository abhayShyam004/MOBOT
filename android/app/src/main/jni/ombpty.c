/*
 * ombpty — the pseudo-terminal half of MOBOT's Android terminal.
 *
 * Why this file exists at all: a terminal is not a pipe. Interactive CLI and
 * TUI programs decide what they are with isatty(2)/tcgetattr(3), they read raw
 * keystrokes, they turn off echo, they size themselves from TIOCGWINSZ, and
 * they die on SIGHUP when their terminal goes away. `java.lang.Process` can
 * only give a child pipes, and Android's own shell has no
 * script(1)/setsid(1)/screen(1) to build one out of (verified absent on the
 * target device). A real PTY therefore has to be created natively — forkpty(3)
 * — and handed back to Kotlin as two integers: a master file descriptor and a
 * pid. Everything else about a session (ids, buffers, state, the UI) is Kotlin.
 *
 * The child is created by forkpty, which does the whole correct sequence for
 * us: openpty + fork + setsid + TIOCSCTTY + dup2 the slave onto 0/1/2 + close
 * the master in the child. That is what makes the child a session leader whose
 * controlling terminal is the PTY — which is what gives the line discipline's
 * Ctrl-C a process group to signal and what makes the kernel send SIGHUP when
 * the master closes.
 *
 * The window size is set BEFORE the fork, so both the PTY and the child start
 * at the size the caller asked for; a later TIOCSWINSZ makes the kernel notify
 * the foreground process group with SIGWINCH on its own.
 *
 * Descriptor discipline: the master descriptor is the parent's only handle on
 * the session and is marked close-on-exec so it can never leak into an
 * unrelated child this app spawns later.
 *
 * Error reporting is honest: exec failures in the child are delivered back to
 * the caller synchronously through a close-on-exec pipe (the libuv technique),
 * so "Permission denied" is answered by spawn() itself rather than becoming a
 * session that is alive, silent, and useless.
 *
 * Nothing here bypasses a platform rule. It is fork+execve from this app's own
 * UID and SELinux domain, exactly what java.lang.Process does — which is why
 * the executable it launches must itself be somewhere this app is allowed to
 * execute from (the APK's own native library directory, or /system/bin).
 *
 * Only async-signal-safe calls are made between forkpty and execve: chdir,
 * execve, write, _exit.
 */
/* pipe2() is guarded behind the GNU feature macros in bionic's headers, and it
 * is the right call here: the child's error channel must be close-on-exec
 * atomically, or a concurrent spawn could inherit the write end. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif

#include <jni.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pty.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

/* Session state codes shared with Kotlin (PtyNative.WAIT_*). */
#define OMB_WAIT_RUNNING 0
#define OMB_WAIT_EXITED 1
#define OMB_WAIT_SIGNALED 2

static void omb_throw(JNIEnv* env, const char* what, int err) {
    char message[512];
    snprintf(message, sizeof message, "%s: %s (errno %d)", what, strerror(err), err);
    jclass cls = (*env)->FindClass(env, "java/io/IOException");
    if (cls != NULL) (*env)->ThrowNew(env, cls, message);
}

/** Convert a Java String[] into a NULL-terminated char* array. */
static char** omb_string_array(JNIEnv* env, jobjectArray array) {
    if (array == NULL) return NULL;
    jsize count = (*env)->GetArrayLength(env, array);
    char** out = (char**)calloc((size_t)count + 1, sizeof(char*));
    if (out == NULL) return NULL;
    for (jsize i = 0; i < count; i++) {
        jstring item = (jstring)(*env)->GetObjectArrayElement(env, array, i);
        if (item == NULL) continue;
        const char* utf = (*env)->GetStringUTFChars(env, item, NULL);
        out[i] = utf == NULL ? NULL : strdup(utf);
        if (utf != NULL) (*env)->ReleaseStringUTFChars(env, item, utf);
        (*env)->DeleteLocalRef(env, item);
    }
    return out;
}

static void omb_free_array(char** array) {
    if (array == NULL) return;
    for (size_t i = 0; array[i] != NULL; i++) free(array[i]);
    free(array);
}

/** True when the child's exec failed: the child's errno arrives on the pipe,
 *  and the pipe's write end is close-on-exec so a successful execve closes it
 *  and the parent reads a clean EOF. Blocking here is deliberate: spawn() does
 *  not return until the program has either started or provably failed. */
static int omb_exec_failure(int pipeRead) {
    int childErrno = 0;
    ssize_t got = read(pipeRead, &childErrno, sizeof childErrno);
    close(pipeRead);
    if (got == (ssize_t)sizeof childErrno) return childErrno != 0 ? childErrno : EIO;
    return 0;
}

/*
 * class com.openmausbot.companion.terminal.NativePty
 * static int[] spawn(String program, String[] argv, String[] env, String cwd,
 *                    int rows, int cols)
 *
 * Returns { masterFd, pid }. Throws IOException when the child could not exec
 * (the message carries the child's own errno and strerror).
 */
JNIEXPORT jintArray JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeSpawn(JNIEnv* env, jclass cls,
                                                        jstring program,
                                                        jobjectArray argv,
                                                        jobjectArray envv,
                                                        jstring cwd,
                                                        jint rows, jint cols) {
    (void)cls;
    char* prog = (char*)(*env)->GetStringUTFChars(env, program, NULL);
    if (prog == NULL) return NULL;
    char* dir = (char*)(*env)->GetStringUTFChars(env, cwd, NULL);
    char** args = omb_string_array(env, argv);
    char** envp = omb_string_array(env, envv);

    int errpipe[2] = { -1, -1 };
    if (args == NULL || (argv != NULL && args[0] == NULL) || pipe2(errpipe, O_CLOEXEC) != 0) {
        int err = errno;
        omb_free_array(args);
        omb_free_array(envp);
        (*env)->ReleaseStringUTFChars(env, program, prog);
        if (dir != NULL) (*env)->ReleaseStringUTFChars(env, cwd, dir);
        omb_throw(env, "creating the terminal's error channel failed", err);
        return NULL;
    }

    struct winsize size;
    memset(&size, 0, sizeof size);
    size.ws_row = (unsigned short)(rows > 0 ? rows : 24);
    size.ws_col = (unsigned short)(cols > 0 ? cols : 80);

    int master = -1;
    pid_t pid = forkpty(&master, NULL, NULL, &size);
    if (pid < 0) {
        int err = errno;
        close(errpipe[0]);
        close(errpipe[1]);
        omb_free_array(args);
        omb_free_array(envp);
        (*env)->ReleaseStringUTFChars(env, program, prog);
        if (dir != NULL) (*env)->ReleaseStringUTFChars(env, cwd, dir);
        omb_throw(env, "forkpty failed", err);
        return NULL;
    }

    if (pid == 0) {
        /* Child. Async-signal-safe calls only, until execve replaces us. */
        if (dir != NULL) chdir(dir);
        execve(prog, args, envp);
        int childErrno = errno;
        ssize_t ignored = write(errpipe[1], &childErrno, sizeof childErrno);
        (void)ignored;
        _exit(127);
    }

    close(errpipe[1]);
    int failed = omb_exec_failure(errpipe[0]);
    omb_free_array(args);
    omb_free_array(envp);
    (*env)->ReleaseStringUTFChars(env, program, prog);
    if (dir != NULL) (*env)->ReleaseStringUTFChars(env, cwd, dir);

    if (failed != 0) {
        /* The session leader exited without exec'ing: reap it and report the
         * real reason instead of handing back a dead terminal. */
        int status = 0;
        while (waitpid(pid, &status, 0) < 0 && errno == EINTR) { }
        close(master);
        omb_throw(env, "the terminal's program could not be started", failed);
        return NULL;
    }

    /* The master must never leak into another child this app spawns. */
    int flags = fcntl(master, F_GETFD);
    if (flags >= 0) fcntl(master, F_SETFD, flags | FD_CLOEXEC);

    jintArray result = (*env)->NewIntArray(env, 2);
    if (result == NULL) {
        close(master);
        kill(-pid, SIGHUP);
        return NULL;
    }
    jint values[2];
    values[0] = (jint)master;
    values[1] = (jint)pid;
    (*env)->SetIntArrayRegion(env, result, 0, 2, values);
    return result;
}

/*
 * static int read(int fd, byte[] buffer, int length)
 *
 * The raw read(2) result: >0 bytes, 0 peer hangup (no process holds the slave
 * open any more), <0 as -errno (EIO is the kernel's way of saying the last
 * slave descriptor closed).
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeRead(JNIEnv* env, jclass cls,
                                                       jint fd, jbyteArray buffer, jint length) {
    (void)cls;
    if (length <= 0) return 0;
    jbyte* bytes = (*env)->GetByteArrayElements(env, buffer, NULL);
    if (bytes == NULL) return -EIO;
    ssize_t got;
    do {
        got = read((int)fd, bytes, (size_t)length);
    } while (got < 0 && errno == EINTR);
    int error = errno;
    int release = 0;
    if (got < 0) {
        (*env)->ReleaseByteArrayElements(env, buffer, bytes, JNI_ABORT);
        error = error == 0 ? EIO : error;
        return -error;
    }
    (*env)->ReleaseByteArrayElements(env, buffer, bytes, release);
    return (jint)got;
}

/*
 * static int write(int fd, byte[] buffer, int offset, int length)
 *
 * Partial writes are normal on a terminal: the caller advances the offset and
 * calls again (TerminalSession does exactly that).
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeWrite(JNIEnv* env, jclass cls,
                                                        jint fd, jbyteArray buffer,
                                                        jint offset, jint length) {
    (void)cls;
    if (length <= 0) return 0;
    jbyte* bytes = (*env)->GetByteArrayElements(env, buffer, NULL);
    if (bytes == NULL) return -EIO;
    ssize_t wrote;
    do {
        wrote = write((int)fd, bytes + offset, (size_t)length);
    } while (wrote < 0 && errno == EINTR);
    int error = errno;
    (*env)->ReleaseByteArrayElements(env, buffer, bytes, JNI_ABORT);
    if (wrote < 0) return -(error == 0 ? EIO : error);
    return (jint)wrote;
}

/*
 * static int resize(int fd, int rows, int cols)
 *
 * TIOCSWINSZ, which also makes the kernel deliver SIGWINCH to the session's
 * foreground process group — the same thing a real terminal emulator does when
 * its window changes size. A TUI that listens (ncurses, readline) reflows
 * without being told twice.
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeResize(JNIEnv* env, jclass cls,
                                                         jint fd, jint rows, jint cols) {
    (void)env;
    (void)cls;
    struct winsize size;
    memset(&size, 0, sizeof size);
    size.ws_row = (unsigned short)(rows > 0 ? rows : 24);
    size.ws_col = (unsigned short)(cols > 0 ? cols : 80);
    if (ioctl((int)fd, TIOCSWINSZ, &size) != 0) return -errno;
    return 0;
}

/*
 * static int[] windowSize(int fd)  →  { rows, cols }  (0,0 when unknown)
 */
JNIEXPORT jintArray JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeWindowSize(JNIEnv* env, jclass cls, jint fd) {
    (void)env;
    (void)cls;
    struct winsize size;
    memset(&size, 0, sizeof size);
    if (ioctl((int)fd, TIOCGWINSZ, &size) != 0) return NULL;
    jintArray result = (*env)->NewIntArray(env, 2);
    if (result == NULL) return NULL;
    jint values[2];
    values[0] = (jint)size.ws_row;
    values[1] = (jint)size.ws_col;
    (*env)->SetIntArrayRegion(env, result, 0, 2, values);
    return result;
}

/*
 * static int[] wait(int pid, boolean noHang)  →  { state, code }
 *
 * state: OMB_WAIT_RUNNING / EXITED / SIGNALED; code is the exit status or the
 * signal number. Reaping here means an exited program never lingers as a
 * zombie behind a session that nobody has closed yet.
 */
JNIEXPORT jintArray JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeWait(JNIEnv* env, jclass cls,
                                                       jint pid, jboolean noHang) {
    (void)env;
    (void)cls;
    if (pid <= 0) return NULL;
    int status = 0;
    pid_t got = waitpid((pid_t)pid, &status, noHang ? WNOHANG : 0);
    if (got < 0) {
        if (errno == ECHILD) {
            /* Already reaped by an earlier call: report it as exited rather
             * than inventing a running session. */
            jintArray gone = (*env)->NewIntArray(env, 2);
            if (gone == NULL) return NULL;
            jint values[2];
            values[0] = OMB_WAIT_EXITED;
            values[1] = 0;
            (*env)->SetIntArrayRegion(env, gone, 0, 2, values);
            return gone;
        }
        return NULL;
    }
    if (got == 0) {
        jintArray running = (*env)->NewIntArray(env, 2);
        if (running == NULL) return NULL;
        jint values[2];
        values[0] = OMB_WAIT_RUNNING;
        values[1] = 0;
        (*env)->SetIntArrayRegion(env, running, 0, 2, values);
        return running;
    }
    jintArray result = (*env)->NewIntArray(env, 2);
    if (result == NULL) return NULL;
    jint values[2];
    if (WIFEXITED(status)) {
        values[0] = OMB_WAIT_EXITED;
        values[1] = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
        values[0] = OMB_WAIT_SIGNALED;
        values[1] = WTERMSIG(status);
    } else {
        values[0] = OMB_WAIT_RUNNING;
        values[1] = 0;
    }
    (*env)->SetIntArrayRegion(env, result, 0, 2, values);
    return result;
}

/*
 * static int signal(int pid, int sig, boolean group)
 *
 * Signals the session's process GROUP by default: the child is its own session
 * leader, so its pid is its process group id, and a pipeline started inside the
 * terminal has to go down with it.
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeSignal(JNIEnv* env, jclass cls,
                                                         jint pid, jint sig, jboolean group) {
    (void)env;
    (void)cls;
    if (pid <= 0) return -EINVAL;
    return kill(group ? -(pid_t)pid : (pid_t)pid, sig) == 0 ? 0 : -errno;
}

/*
 * static int pollIn(int fd, int timeoutMs)
 *
 * 1 = readable, 2 = the peer hung up (POLLHUP/POLLERR — the session's last
 * slave descriptor closed), 0 = the timeout elapsed with nothing to read, <0 =
 * -errno, POLLNVAL (the descriptor was closed under us) reported as 2.
 *
 * This is what lets one thread per session do the whole job: wait for output
 * without blocking forever, read what is there, and poll the child for exit —
 * so a session never needs a second thread and a close() can never be left
 * waiting on a read() that will not return.
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativePollIn(JNIEnv* env, jclass cls,
                                                         jint fd, jint timeoutMs) {
    (void)env;
    (void)cls;
    struct pollfd target;
    target.fd = (int)fd;
    target.events = POLLIN;
    target.revents = 0;
    int result;
    do {
        result = poll(&target, 1, (int)timeoutMs);
    } while (result < 0 && errno == EINTR);
    if (result < 0) return -errno;
    if (target.revents & POLLNVAL) return 2;
    if (target.revents & (POLLHUP | POLLERR)) return 2;
    return (target.revents & POLLIN) ? 1 : 0;
}

/*
 * static int closeFd(int fd)
 */
JNIEXPORT jint JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeCloseFd(JNIEnv* env, jclass cls, jint fd) {
    (void)env;
    (void)cls;
    if (fd < 0) return -EINVAL;
    return close((int)fd) == 0 ? 0 : -errno;
}

/*
 * static boolean isTerminal(int fd) — isatty(3), so the *device* answers
 * whether a session really has a terminal, not our own bookkeeping.
 */
JNIEXPORT jboolean JNICALL
Java_com_openmausbot_companion_terminal_NativePty_nativeIsTerminal(JNIEnv* env, jclass cls, jint fd) {
    (void)env;
    (void)cls;
    return isatty((int)fd) == 1 ? JNI_TRUE : JNI_FALSE;
}

