"""
HAT Architecture Placeholder

This is a placeholder for the actual HAT (Hybrid Attention Transformer) architecture.
The real implementation would come from: https://github.com/XPixelGroup/HAT

For now, this allows the ModelManager to load without errors.
"""

import torch
import torch.nn as nn


class HAT(nn.Module):
    """
    Placeholder for HAT architecture

    Real implementation: https://github.com/XPixelGroup/HAT
    """

    def __init__(self, *args, **kwargs):
        super().__init__()
        raise NotImplementedError(
            "HAT architecture not yet implemented. "
            "To use HAT, add the architecture from: "
            "https://github.com/XPixelGroup/HAT/blob/main/hat/archs/hat_arch.py"
        )

    def forward(self, x):
        raise NotImplementedError("HAT not implemented")
