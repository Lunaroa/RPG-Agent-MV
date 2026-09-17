package org.rpgagent.runtime;

interface UpdateProgressListener {
    void onProgress(String stage, long received, long total, long bytesPerSecond, String message);
}
