package com.gunydrive.catalog

import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Size
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import android.webkit.MimeTypeMap
import java.io.ByteArrayOutputStream

class DeviceCatalogModule : Module() {
  private val visibleFiles = listOf(
    "mime_type IS NOT NULL", "_data IS NOT NULL", "_data NOT LIKE '%/.%'",
    *listOf("Android", "cache", "caches", "code_cache", "thumbcache", "thumbnails", "tmp", "temp")
      .map { "_data NOT LIKE '%/$it/%'" }.toTypedArray()
  ).joinToString(" AND ")

  override fun definition() = ModuleDefinition {
    Name("GunyDeviceCatalog")

    Function("hasSharedStorageAccess") {
      Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()
    }
    AsyncFunction("requestSharedStorageAccess") {
      val activity = requireNotNull(appContext.currentActivity)
      if (Build.VERSION.SDK_INT >= 30) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:" + activity.packageName)))
      }
      Unit
    }

    AsyncFunction("storageRoots") {
      val context = requireNotNull(appContext.reactContext)
      val roots = context.getExternalFilesDirs(null).filterNotNull().map {
        File(it.absolutePath.substringBefore("/Android/data/"))
      }.plus(Environment.getExternalStorageDirectory()).distinctBy { it.canonicalPath }
      roots.filter { it.isDirectory }.map { Uri.fromFile(it).toString() }
    }

    AsyncFunction("listDirectory") { raw: String ->
      val path = requireNotNull(Uri.parse(raw).path)
      val directory = File(path).canonicalFile
      val children = directory.listFiles() ?: throw IllegalStateException("Folder tidak dapat dibaca.")
      children.mapNotNull { file ->
        // Skip symbolic links to avoid traversing cycles or leaving the selected tree.
        if (file.absoluteFile != file.canonicalFile) return@mapNotNull null
        val directoryEntry = file.isDirectory
        mapOf("uri" to Uri.fromFile(file).toString(), "name" to file.name,
          "directory" to directoryEntry, "sizeBytes" to if (directoryEntry) 0L else file.length(),
          "mtime" to file.lastModified(), "mimeType" to
            (MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: ""))
      }
    }

    AsyncFunction("indexedVolumes") {
      if (Build.VERSION.SDK_INT >= 29) MediaStore.getExternalVolumeNames(requireNotNull(appContext.reactContext)).sorted()
      else listOf("external")
    }

    AsyncFunction("indexedCount") { countRows("external") }
    AsyncFunction("countForVolume") { volume: String -> countRows(volume) }
    AsyncFunction("page") { after: Long -> readPage("external", after) }
    AsyncFunction("pageForVolume") { volume: String, after: Long -> readPage(volume, after) }

    AsyncFunction("thumbnail") { raw: String ->
      val uri = Uri.parse(raw)
      if (Build.VERSION.SDK_INT < 29 || uri.scheme != "content") return@AsyncFunction null
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      val bitmap = resolver.loadThumbnail(uri, Size(192, 192), null)
      try {
        val bytes = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 70, bytes)
        "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
      } finally {
        bitmap.recycle()
      }
    }

    Function("canInstallPackages") {
      if (Build.VERSION.SDK_INT < 26) true
      else requireNotNull(appContext.reactContext).packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("requestInstallPackagesPermission") {
      val activity = requireNotNull(appContext.currentActivity)
      if (Build.VERSION.SDK_INT >= 26) {
        val intent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + activity.packageName)
        )
        activity.startActivity(intent)
      }
      Unit
    }

    AsyncFunction("installApk") { rawUri: String ->
      val context = requireNotNull(appContext.reactContext)
      val activity = requireNotNull(appContext.currentActivity)
      val parsed = Uri.parse(rawUri)
      val sourcePath = if (parsed.scheme == "file") parsed.path else rawUri
      val sourceFile = File(requireNotNull(sourcePath)).canonicalFile
      if (!sourceFile.exists() || !sourceFile.isFile || sourceFile.length() <= 0L) {
        throw IllegalStateException("Berkas APK pembaruan tidak ditemukan atau kosong.")
      }

      if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
        val permIntent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + activity.packageName)
        )
        activity.startActivity(permIntent)
        return@AsyncFunction "permission_required"
      }

      val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }.canonicalFile
      val apkFile = if (sourceFile.canonicalPath.startsWith(updatesDir.canonicalPath + File.separator)) {
        sourceFile
      } else {
        val safeName = sourceFile.name.ifBlank { "gunydrive-update.apk" }
        val copied = File(updatesDir, if (safeName.endsWith(".apk", ignoreCase = true)) safeName else "$safeName.apk")
        sourceFile.copyTo(copied, overwrite = true)
        copied
      }

      val contentUri = FileProvider.getUriForFile(
        context,
        context.packageName + ".UpdateFileProvider",
        apkFile
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(installIntent)
      "installing"
    }
  }


  private fun countRows(volume: String): Int {
    val resolver = requireNotNull(appContext.reactContext).contentResolver
    return resolver.query(MediaStore.Files.getContentUri(volume), arrayOf("_id"), visibleFiles, null, null)
      ?.use { it.count } ?: 0
  }

  private fun readPage(volume: String, after: Long): List<Map<String, Any?>> {
    val resolver = requireNotNull(appContext.reactContext).contentResolver
      val columns = arrayOf("_id", "_display_name", "mime_type", "_size", "_data", "date_modified", "media_type",
        if (Build.VERSION.SDK_INT >= 29) "duration" else "date_added")
      val rows = mutableListOf<Map<String, Any?>>()
      val collection = MediaStore.Files.getContentUri(volume)
      val selection = "_id > ? AND $visibleFiles"
      val args = android.os.Bundle().apply {
        putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
        putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(after.toString()))
        putStringArray(android.content.ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf("_id"))
        putInt(android.content.ContentResolver.QUERY_ARG_SORT_DIRECTION, android.content.ContentResolver.QUERY_SORT_DIRECTION_ASCENDING)
        putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, 250)
      }
      val cursor = if (Build.VERSION.SDK_INT >= 30) resolver.query(collection, columns, args, null)
        else resolver.query(collection, columns, selection, arrayOf(after.toString()), "_id ASC LIMIT 250")
      requireNotNull(cursor).use {
        while (rows.size < 250 && it.moveToNext()) {
          val id = it.getLong(0)
          val type = it.getInt(6)
          val base = when (type) {
            1 -> MediaStore.Images.Media.getContentUri(volume)
            2 -> MediaStore.Audio.Media.getContentUri(volume)
            3 -> MediaStore.Video.Media.getContentUri(volume)
            else -> MediaStore.Files.getContentUri(volume)
          }
          val path = it.getString(4)
          val modifiedMs = it.getLong(5) * 1000L
          rows.add(mapOf("cursor" to id, "id" to ContentUris.withAppendedId(base, id).toString(),
            "filename" to it.getString(1), "mime" to it.getString(2), "size" to it.getLong(3),
            "path" to path, "modificationTime" to modifiedMs,
            "duration" to if (Build.VERSION.SDK_INT >= 29 && !it.isNull(7)) it.getLong(7) else null))
        }
      }
      return rows
    }

}
