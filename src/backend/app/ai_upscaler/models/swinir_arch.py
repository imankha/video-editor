"""
SwinIR Architecture Placeholder

This is a placeholder for the actual SwinIR architecture.
The real implementation would come from: https://github.com/JingyunLiang/SwinIR

For now, this allows the ModelManager to load without errors.
"""

import torch
import torch.nn as nn


class SwinIR(nn.Module):
    """
    Placeholder for SwinIR architecture

    Real implementation: https://github.com/JingyunLiang/SwinIR
    """

    def __init__(self, *args, **kwargs):
        super().__init__()
        raise NotImplementedError(
            "SwinIR architecture not yet implemented. "
            "To use SwinIR, add the architecture from: "
            "https://github.com/JingyunLiang/SwinIR/blob/main/models/network_swinir.py"
        )

    def forward(self, x):
        raise NotImplementedError("SwinIR not implemented")
