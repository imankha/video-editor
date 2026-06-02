# T3240: Direct R2 Streaming Experiment

**Status:** ABSORBED
**Absorbed by:** [T3250](T3250-direct-r2-streaming-fix.md)
**Reason:** T3240 framed this work as a feature-flagged experiment. Playback stalls observed on 2026-06-02 (590 KB/s throughput, 26s stall on 19.5MB range request) confirmed the proxy is the bottleneck. T3250 implements the same presigned URL approach as a direct fix rather than an experiment.

All implementation details, research findings, and acceptance criteria from T3240 are incorporated into T3250.
