package com.openmausbot.companion.reach

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.UUID

/**
 * Text-to-speech speaker for reading scheduled MOBOT reminders upon answering.
 * Uses local Android TTS facilities without requiring internet or an active Node agent.
 * Supports earpiece audio routing (smaller speaker near the ear) for call-like reminders.
 */
class ReachTtsSpeaker(
    private val context: Context,
    private val onInitComplete: ((Boolean) -> Unit)? = null,
    private val onSpeechDone: (() -> Unit)? = null,
) {
    private var tts: TextToSpeech? = null
    private var isReady = false
    private val lock = Any()
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private var isRoutedToEarpiece = false

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            synchronized(lock) {
                if (status == TextToSpeech.SUCCESS) {
                    val result = tts?.setLanguage(Locale.getDefault())
                    isReady = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED

                    // Configure communication-grade audio attributes so output can be routed
                    // to the device earpiece receiver.
                    val audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                    tts?.setAudioAttributes(audioAttributes)

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
                resetAudioRouting()
                onSpeechDone?.invoke()
            }

            @Suppress("DEPRECATION")
            override fun onError(utteranceId: String?) {
                Log.w(TAG, "TTS error on utterance $utteranceId")
                resetAudioRouting()
                onSpeechDone?.invoke()
            }
        })
    }

    /**
     * Routes voice output to the device earpiece (smaller speaker near ear)
     * or active communication headset rather than loud external speakerphone.
     * Verifies resulting output device via getCommunicationDevice().
     */
    fun routeToEarpiece() {
        synchronized(lock) {
            val am = audioManager ?: return
            try {
                am.mode = AudioManager.MODE_IN_COMMUNICATION
                am.isSpeakerphoneOn = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val devices = am.availableCommunicationDevices
                    // Handle external headsets if connected; otherwise route to builtin earpiece
                    val headset = devices.firstOrNull {
                        it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                        it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                        it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
                    }
                    val targetDevice = headset ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
                    if (targetDevice != null) {
                        val routed = am.setCommunicationDevice(targetDevice)
                        val activeDevice = am.communicationDevice
                        val verified = activeDevice?.id == targetDevice.id || activeDevice?.type == targetDevice.type
                        Log.i(TAG, "Audio routed to builtin earpiece: $routed (device type=${targetDevice.type}, verified=$verified, active=${activeDevice?.type})")
                    } else {
                        Log.w(TAG, "No TYPE_BUILTIN_EARPIECE or headset found among: ${devices.map { it.type }}; using MODE_IN_COMMUNICATION fallback")
                    }
                }
                isRoutedToEarpiece = true
            } catch (e: Exception) {
                Log.e(TAG, "Failed routing to earpiece: ${e.message}")
            }
        }
    }

    /**
     * Resets audio routing back to default MODE_NORMAL and clears communication device.
     */
    fun resetAudioRouting() {
        synchronized(lock) {
            if (!isRoutedToEarpiece) return
            val am = audioManager ?: return
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    am.clearCommunicationDevice()
                    val cleared = am.communicationDevice == null
                    Log.d(TAG, "Communication device cleared: $cleared")
                }
                am.isSpeakerphoneOn = false
                am.mode = AudioManager.MODE_NORMAL
                isRoutedToEarpiece = false
                Log.i(TAG, "Audio routing restored to MODE_NORMAL")
            } catch (e: Exception) {
                Log.e(TAG, "Failed resetting audio routing: ${e.message}")
            }
        }
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
            } finally {
                resetAudioRouting()
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
                resetAudioRouting()
                tts = null
                isReady = false
            }
        }
    }

    companion object {
        private const val TAG = "ReachTtsSpeaker"
    }
}
