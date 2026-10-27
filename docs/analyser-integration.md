# Connecting lab analysers to MitochronAi

*Plan, 2026-10-19. Nothing here is built yet; it needs the details of the lab's machines (questions at the end).*

## How analysers talk to a lab system

| Layer | What most analysers use | Notes |
|---|---|---|
| **Cable** | RS-232 serial (often through a USB-serial adapter) or Ethernet (TCP/IP) | Older and smaller machines are usually serial; newer ones Ethernet. |
| **Low-level protocol** | ASTM E1381 / CLSI LIS1-A (framing, checksums, ENQ/ACK handshakes) | Over TCP/IP, some vendors use MLLP framing instead. |
| **Message format** | ASTM E1394 / CLSI LIS2-A2 (records H, P, O, R, C, Q, L) or HL7 v2.x (ORU^R01 results, ORM/OML orders) | Each vendor documents its own variant in a *host interface manual*. |
| **Direction** | Unidirectional (the analyser sends results) or bidirectional (the analyser also asks which tests to run for a barcode: a "host query") | Bidirectional needs barcoded samples. |

The vendor's **LIS/host interface manual** for the exact model and software version is essential: the layouts differ even between models of one brand. Some vendors sell the interface as a licence option.

## Design for MitochronAi

```
Analyser ──RS-232 / TCP──▶ MitochronAi Connector (small service on the lab PC)
                              │  frames, checksums, parses ASTM/HL7
                              │  maps analyser codes → catalogue codes
                              ▼
                     MitochronAi server (lab network only)
                              │  results arrive as "entered", from the analyser
                              ▼
                     Gaya's checks → chief scientist approval (unchanged)
```

1. **A separate Connector service**, one per analyser PC, rather than opening ports in the web app. It only talks to the MitochronAi server on the lab network.
2. **Sample identity:** MitochronAi prints a barcode label (request ID + sample type) at registration. The analyser reads it; the result comes back with the same ID. For analysers without a reader, MitochronAi offers a worklist the operator loads.
3. **Mapping table per analyser** (analyser test code → analyte code, unit, decimal places, unit conversion), editable by the chief scientist and audited.
4. **Nothing is guessed:** a message with a bad checksum, unknown sample ID, unknown test code, unit mismatch or implausible value goes to an *Interface queue* screen for a human, never silently into a result.
5. **Results stay reviewed:** analyser results go through Gaya's checks and the chief scientist's approval exactly like typed results, with the analyser name, serial number, run time and raw message kept on the record.
6. **QC from the analyser:** control results (recognised by their control IDs) go straight to the QC module and Westgard rules.
7. **Simulator first:** a replay tool sends real-format ASTM/HL7 messages so everything is tested before touching a machine.

## Questions for John (per analyser)

1. Make and model, and the software/firmware version (on the analyser's "About" or service screen).
2. Which tests it runs in the lab (for example FBC; chemistry panel; HbA1c; TSH).
3. The connection ports on the back: 9-pin serial (RS-232), USB, Ethernet (RJ-45)?
4. Is an LIS/host connection enabled in its settings, or does the vendor need to activate it? Is there a "Host" or "LIS" settings page?
5. Does it read sample barcodes?
6. Is it on the same network as the lab PC, or standalone?
7. The vendor's host interface manual (PDF or photos of the pages), or the local distributor's engineer contact.
8. If possible: a sample of its output (from a print-to-file or capture), using test or QC samples only.
