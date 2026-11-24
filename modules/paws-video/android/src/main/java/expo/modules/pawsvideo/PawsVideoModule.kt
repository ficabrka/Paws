package expo.modules.pawsvideo

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

@OptIn(markerClass = [UnstableApi::class])
class PawsVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PawsVideo")

    AsyncFunction("process") { uri: String, speed: Double, shortSide: Int, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("ERR_CONTEXT", "No Android context", null)
        return@AsyncFunction
      }
      val out = File(ctx.cacheDir, "paws_${System.currentTimeMillis()}.mp4")
      // Transformer must be created and started on a thread with a Looper: use the main thread.
      Handler(Looper.getMainLooper()).post {
        try {
          val videoEffects = mutableListOf<Effect>()
          if (speed > 1.01) videoEffects.add(SpeedChangeEffect(speed.toFloat()))
          videoEffects.add(Presentation.createForShortSide(shortSide))
          val edited = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(uri)))
            .setRemoveAudio(true)
            .setEffects(Effects(listOf(), videoEffects))
            .build()
          val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(2_500_000).build())
            .build()
          val transformer = Transformer.Builder(ctx)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setEncoderFactory(encoders)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                promise.resolve(
                  mapOf(
                    "uri" to Uri.fromFile(out).toString(),
                    "durationMs" to exportResult.approximateDurationMs.toDouble(),
                    "size" to out.length().toDouble()
                  )
                )
              }

              override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                promise.reject("ERR_EXPORT", exportException.message ?: "export failed", exportException)
              }
            })
            .build()
          transformer.start(edited, out.absolutePath)
        } catch (e: Exception) {
          promise.reject("ERR_EXPORT", e.message ?: "export failed", e)
        }
      }
    }
  }
}
