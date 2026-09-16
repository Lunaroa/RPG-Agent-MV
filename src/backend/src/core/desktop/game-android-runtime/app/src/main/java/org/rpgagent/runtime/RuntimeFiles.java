package org.rpgagent.runtime;

import android.content.res.AssetManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class RuntimeFiles {
    private RuntimeFiles() {}

    static File safeFile(File root, String relativePath) throws IOException {
        String portable = relativePath == null ? "" : relativePath.replace('\\', '/');
        if (portable.isEmpty() || portable.startsWith("/") || portable.contains(":")) {
            throw new IOException("Unsafe update path: " + relativePath);
        }
        for (String part : portable.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) {
                throw new IOException("Unsafe update path: " + relativePath);
            }
        }
        File canonicalRoot = root.getCanonicalFile();
        File target = new File(canonicalRoot, portable).getCanonicalFile();
        String rootPrefix = canonicalRoot.getPath() + File.separator;
        if (!target.getPath().startsWith(rootPrefix)) throw new IOException("Update path escaped its root: " + relativePath);
        return target;
    }

    static void copyFile(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            throw new IOException("Could not create update directory: " + parent);
        }
        try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(target)) {
            copy(input, output);
        }
    }

    static void copyDirectory(File source, File target) throws IOException {
        if (!source.isDirectory()) throw new IOException("Content directory is missing: " + source);
        if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Could not create content directory: " + target);
        File[] children = source.listFiles();
        if (children == null) throw new IOException("Could not list content directory: " + source);
        for (File child : children) {
            File destination = new File(target, child.getName());
            if (child.isDirectory()) copyDirectory(child, destination);
            else if (child.isFile()) copyFile(child, destination);
            else throw new IOException("Unsupported content entry: " + child);
        }
    }

    static void copyAssetDirectory(AssetManager assets, String source, File target) throws IOException {
        String[] children = assets.list(source);
        if (children == null) throw new IOException("Could not list packaged content: " + source);
        if (children.length == 0) {
            File parent = target.getParentFile();
            if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
                throw new IOException("Could not create packaged content directory: " + parent);
            }
            try (InputStream input = assets.open(source); OutputStream output = new FileOutputStream(target)) {
                copy(input, output);
            }
            return;
        }
        if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Could not create content directory: " + target);
        for (String child : children) copyAssetDirectory(assets, source + "/" + child, new File(target, child));
    }

    static void deleteRecursively(File target) throws IOException {
        if (!target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children == null) throw new IOException("Could not list path for cleanup: " + target);
            for (File child : children) deleteRecursively(child);
        }
        if (!target.delete()) throw new IOException("Could not remove path: " + target);
    }

    static List<String> listRelativeFiles(File root) throws IOException {
        List<String> result = new ArrayList<>();
        listRelativeFiles(root.getCanonicalFile(), root.getCanonicalFile(), result);
        Collections.sort(result);
        return result;
    }

    private static void listRelativeFiles(File root, File directory, List<String> result) throws IOException {
        File[] children = directory.listFiles();
        if (children == null) throw new IOException("Could not list content directory: " + directory);
        for (File child : children) {
            if (child.isDirectory()) listRelativeFiles(root, child, result);
            else if (child.isFile()) {
                String relative = root.toPath().relativize(child.getCanonicalFile().toPath()).toString().replace('\\', '/');
                result.add(relative);
            } else throw new IOException("Unsupported content entry: " + child);
        }
    }

    static String sha256(File file) throws IOException {
        MessageDigest digest = sha256Digest();
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    static String sha256(byte[] value) {
        MessageDigest digest = sha256Digest();
        return hex(digest.digest(value));
    }

    static MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable.", error);
        }
    }

    static String readText(InputStream input) throws IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        copy(input, output);
        return output.toString(StandardCharsets.UTF_8.name());
    }

    static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
    }

    static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }
}
