package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class PhoneReplyModelTest {
    private val computer=ModelSettings("https://computer.example/personal/v1/models/test/chat/completions","computer-model","","电脑模型")
    private val phone=ModelSettings("https://model.example/v1","phone-model","synthetic-key","手机模型")
    @Test fun unreachableComputerUsesTheAccountPhoneModelDirectly() {
        val reply=phoneReplyModel(computer,true,true){phone}
        assertSame(phone,reply.settings)
        assertFalse(reply.viaComputer)
    }
    @Test fun onlineComputerKeepsTheSelectedComputerModel() {
        val reply=phoneReplyModel(computer,true,false){error("must not read a different selection")}
        assertSame(computer,reply.settings)
        assertTrue(reply.viaComputer)
    }
    @Test fun configuredPhoneModelDoesNotDependOnTheComputer() {
        val reply=phoneReplyModel(phone,false,true){error("must not replace the phone selection")}
        assertSame(phone,reply.settings)
        assertFalse(reply.viaComputer)
    }
    @Test fun missingPhoneModelExplainsConfigurationInsteadOfCallingTheOfflineComputer() {
        val failure=assertThrows(ApiFailure::class.java){phoneReplyModel(computer,true,true){null}}
        assertEquals("MODEL_NOT_CONFIGURED",failure.safeCode)
    }
}
