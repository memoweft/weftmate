package com.memoweft.weftmate.mobile

internal data class PhoneReplyModel(val settings: ModelSettings, val viaComputer: Boolean)

/** A confirmed local turn must not send its completion back through an unreachable computer. */
internal fun phoneReplyModel(configured: ModelSettings?, computerModel: Boolean, computerUnavailable: Boolean,
    accountModel: () -> ModelSettings?): PhoneReplyModel =
    if (computerModel && computerUnavailable)
        PhoneReplyModel(accountModel() ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED"), false)
    else PhoneReplyModel(configured ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED"), computerModel)
