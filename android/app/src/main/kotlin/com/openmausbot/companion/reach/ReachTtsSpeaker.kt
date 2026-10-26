package com.openmausbot.companion.reach

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.UUID

/**
 * Text-to-speech speaker for reading scheduled MOBOT reminders upon answering.
 * Uses local Android TTS facilities without requiring internet or an active Node agent.
 */
class ReachTtsSpeaker(
    private val context: Context,
    private val onInitComplete: ((Boolean) -> Unit)? = null,
    private val onSpeechDone: (() -> Unit)? = null,
) {
    private var tts: TextToSpeech? = null
    private var isReady = false
    private val lock = Any()

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            synchronized(lock) {
                if (status == TextToSpeech.SUCCESS) {
                    val result = tts?.setLanguage(Locale.getDefault())
                    isReady = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED
                    Log.i(TAG, "TTS initialized successfully (locale=${Locale.getDefault()}, supported=$isReady)")
                    setupListener()
                    onInitComplete?.invoke(true)
                } else {
                    isReady = false
                    Log.w(TAG, "TTS initialization failed with status: $status")
                    onInitComplete?.invoke(false)
                }
            }
        }
    }

    private fun setupListener() {
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                Log.d(TAG, "TTS started speaking utterance $utteranceId")
            }

            override fun onDone(utteranceId: String?) {
                Log.d(TAG, "TTS completed utterance $utteranceId")
                onSpeechDone?.invoke()
            }

            @Suppress("DEPRECATION")
            override fun onError(utteranceId: String?) {
                Log.w(TAG, "TTS error on utterance $utteranceId")
                onSpeechDone?.invoke()
            }
        })
    }

    fun speak(text: String): Boolean {
        synchronized(lock) {
            if (!isReady || tts == null) {
                Log.w(TAG, "TTS not ready to speak. Fallback to visual presentation.")
                return false
            }
            val utteranceId = UUID.randomUUID().toString()
            val params = Bundle()
            val res = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
            return res == TextToSpeech.SUCCESS
        }
    }

    fun stop() {
        synchronized(lock) {
            try {
                tts?.stop()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping TTS: ${e.message}")
            }
        }
    }

    fun shutdown() {
        synchronized(lock) {
            try {
                tts?.stop()
                tts?.shutdown()
            } catch (e: Exception) {
                Log.w(TAG, "Error shutting down TTS: ${e.message}")
            } finally {
                tts = null
                isReady = false
            }
        }
    }

    companion object {
        private const val TAG = "ReachTtsSpeaker"
    }
}
