// Native test adapter only. The key and message are public synthetic fixtures.
import CryptoKit
import Foundation

@main
struct PhoneSecretInteropFixture {
    static func main() throws {
        guard #available(macOS 14.0, *) else {
            throw NSError(domain: "PhoneSecretInteropFixture", code: 1)
        }
        try run()
    }

    @available(macOS 14.0, *)
    static func run() throws {
        let context = PhoneSecretRequestContext(
            deviceId: "paired-device-1", botId: "bot-1", threadId: "thread-1",
            messageId: "message-1", target: "ttsKey", requestKey: "credential-request-1"
        )
        let plaintext = "swift-to-node-secret"
        let keyId = "taWSR_nZ7ojlH_0Z3tar6Q"
        let mode = CommandLine.arguments.last
        if mode == "encrypt" {
            let envelope = try PhoneSecretCrypto.encrypt(
                plaintext,
                publicKey: "BIPBQ12_dWnF1DZLsTZO3Vg0NGjds5-jp9h3jhjr2To7bJelczS0LM82rfXV68PmSJhz2ePosj3fL974XckCpDU",
                context: context
            )
            FileHandle.standardOutput.write(try JSONEncoder().encode(envelope))
        } else if mode == "decrypt" {
            let envelope = try JSONDecoder().decode(PhoneSecretEnvelope.self, from: FileHandle.standardInput.readDataToEndOfFile())
            guard envelope.version == 1, envelope.keyId == keyId,
                  envelope.deviceId == context.deviceId, envelope.threadId == context.threadId,
                  envelope.target == context.target, envelope.requestKey == context.requestKey else {
                throw NSError(domain: "PhoneSecretInteropFixture", code: 2)
            }
            func data(_ value: String) -> Data {
                var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
                base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
                return Data(base64Encoded: base64)!
            }
            let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: data("5B-SwYLGXc04u4v7YLpzFrwj2JjysBFaJevOPl3h3Zg"))
            var recipient = try HPKE.Recipient(
                privateKey: privateKey, ciphersuite: .P256_SHA256_AES_GCM_256,
                info: Data(PhoneSecretCrypto.info.utf8), encapsulatedKey: data(envelope.encapsulatedKey)
            )
            let opened = try recipient.open(data(envelope.ciphertext), authenticating: PhoneSecretCrypto.authenticatedData(keyId: keyId, context: context))
            guard opened == Data(plaintext.utf8) else {
                throw NSError(domain: "PhoneSecretInteropFixture", code: 3)
            }
            // Never emit the decrypted value, including on failure.
            FileHandle.standardOutput.write(Data("{\"ok\":true}".utf8))
        } else {
            throw NSError(domain: "PhoneSecretInteropFixture", code: 4)
        }
    }
}
