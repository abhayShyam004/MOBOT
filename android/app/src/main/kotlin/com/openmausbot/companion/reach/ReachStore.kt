package com.openmausbot.companion.reach

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Thread-safe, persistent storage for MOBOT Reach events.
 * Persists event state to an internal JSON file using atomic write-then-rename,
 * ensuring event metadata survives app closure, process termination, and reboots.
 */
class ReachStore(private val context: Context) {

    private val lock = Any()
    private val memoryCache = ConcurrentHashMap<String, ReachEvent>()
    private val storeFile: File by lazy {
        val dir = File(context.filesDir, "reach")
        if (!dir.exists()) dir.mkdirs()
        File(dir, "reach_events.json")
    }

    init {
        loadFromDisk()
    }

    private fun loadFromDisk() {
        synchronized(lock) {
            memoryCache.clear()
            if (!storeFile.exists() || storeFile.length() == 0L) return

            try {
                val content = storeFile.readText(Charsets.UTF_8)
                val json = JSONObject(content)
                val array = json.optJSONArray("events") ?: JSONArray()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val event = ReachEvent.fromJson(obj)
                    memoryCache[event.id] = event
                }
                Log.d(TAG, "Loaded ${memoryCache.size} reach events from disk.")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load reach events from disk: ${e.message}", e)
            }
        }
    }

    private fun persistToDiskLocked() {
        try {
            val root = JSONObject()
            val array = JSONArray()
            memoryCache.values.forEach { array.put(it.toJson()) }
            root.put("version", 1)
            root.put("events", array)

            val tmpFile = File(storeFile.parentFile, "${storeFile.name}.tmp")
            tmpFile.writeText(root.toString(2), Charsets.UTF_8)
            if (tmpFile.renameTo(storeFile)) {
                // Success
            } else {
                // Fallback copy if rename fails on some file systems
                storeFile.writeText(root.toString(2), Charsets.UTF_8)
                tmpFile.delete()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to persist reach events to disk: ${e.message}", e)
        }
    }

    fun saveEvent(event: ReachEvent): ReachEvent {
        synchronized(lock) {
            val updated = event.copy(updatedAtMs = System.currentTimeMillis())
            memoryCache[updated.id] = updated
            persistToDiskLocked()
            return updated
        }
    }

    fun getEvent(id: String): ReachEvent? {
        return memoryCache[id]
    }

    fun getAllEvents(): List<ReachEvent> {
        return memoryCache.values.sortedByDescending { it.createdAtMs }
    }

    fun getActiveEvents(): List<ReachEvent> {
        return memoryCache.values.filter {
            it.state == ReachEventState.SCHEDULED || it.state == ReachEventState.SNOOZED
        }.sortedBy { it.triggerTimeMs }
    }

    fun updateState(id: String, newState: ReachEventState): ReachEvent? {
        synchronized(lock) {
            val existing = memoryCache[id] ?: return null
            val updated = existing.copy(
                state = newState,
                updatedAtMs = System.currentTimeMillis()
            )
            memoryCache[id] = updated
            persistToDiskLocked()
            return updated
        }
    }

    fun deleteEvent(id: String): Boolean {
        synchronized(lock) {
            val removed = memoryCache.remove(id) != null
            if (removed) {
                persistToDiskLocked()
            }
            return removed
        }
    }

    companion object {
        private const val TAG = "ReachStore"

        @Volatile
        private var instance: ReachStore? = null

        fun getInstance(context: Context): ReachStore {
            return instance ?: synchronized(this) {
                instance ?: ReachStore(context.applicationContext).also { instance = it }
            }
        }
    }
}
