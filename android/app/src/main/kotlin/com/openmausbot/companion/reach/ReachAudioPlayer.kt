package com.openmausbot.companion.reach

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * Manages audible ringing and haptic vibration for incoming MOBOT reach events.
 * Ensures clean audio cleanup upon user answer, dismissal, or snooze.
 */
object ReachAudioPlayer {

    private const val TAG = "ReachAudioPlayer"
    private var mediaPlayer: MediaPlayer? = null
    private var isPlaying = false
    private val lock = Any()

    fun startRinging(context: Context, isCall: Boolean) {
        synchronized(lock) {
            if (isPlaying) {
                Log.d(TAG, "Already ringing, skipping startRinging call.")
                return
            }
            isPlaying = true

            // 1. Audio playback
            try {
                val soundType = if (isCall) RingtoneManager.TYPE_RINGTONE else RingtoneManager.TYPE_ALARM
                var ringtoneUri: Uri? = RingtoneManager.getActualDefaultRingtoneUri(context, soundType)
                if (ringtoneUri == null) {
                    ringtoneUri = RingtoneManager.getDefaultUri(soundType)
                }

                val usage = if (isCall) AudioAttributes.USAGE_NOTIFICATION_RINGTONE else AudioAttributes.USAGE_ALARM
                val attributes = AudioAttributes.Builder()
                    .setUsage(usage)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()

                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(attributes)
                    setDataSource(context, ringtoneUri)
                    isLooping = true
                    prepare()
                    start()
                }
                Log.i(TAG, "Started ringing sound with usage $usage.")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start media player for ringing: ${e.message}", e)
            }

            // 2. Vibration
            try {
                val vibrator = getVibrator(context)
                if (vibrator != null && vibrator.hasVibrator()) {
                    val pattern = longArrayOf(0, 800, 800, 800)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        val effect = VibrationEffect.createWaveform(pattern, 0)
                        vibrator.vibrate(effect)
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(pattern, 0)
                    }
                    Log.i(TAG, "Started repeating vibration pattern.")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start vibration: ${e.message}", e)
            }
        }
    }

    fun stopRinging(context: Context? = null) {
        synchronized(lock) {
            isPlaying = false

            // Stop audio
            try {
                mediaPlayer?.let { player ->
                    if (player.isPlaying) {
                        player.stop()
                    }
                    player.reset()
                    player.release()
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error releasing media player: ${e.message}")
            } finally {
                mediaPlayer = null
            }

            // Stop vibration
            if (context != null) {
                try {
                    val vibrator = getVibrator(context)
                    vibrator?.cancel()
                } catch (e: Exception) {
                    Log.w(TAG, "Error cancelling vibration: ${e.message}")
                }
            }
            Log.i(TAG, "Ringing and vibration stopped.")
        }
    }

    private fun getVibrator(context: Context): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}
