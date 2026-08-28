import 'dart:async';

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Bouton micro de la barre de recherche — reconnaissance vocale en français.
///
/// `SpeechToText.initialize()` gère la demande de permission micro en
/// interne, comme `geolocator`/`mobile_scanner` déjà dans le code (§ Explorer).
/// Aucune exception ne remonte au-delà de ce widget : permission refusée,
/// service indisponible sur l'appareil (fréquent en émulateur sans compte
/// Google) ou erreur de reconnaissance se traduisent toutes par un `SnackBar`,
/// jamais par un crash.
class VoiceSearchButton extends StatefulWidget {
  const VoiceSearchButton({required this.onResult, super.key});

  final ValueChanged<String> onResult;

  @override
  State<VoiceSearchButton> createState() => _VoiceSearchButtonState();
}

class _VoiceSearchButtonState extends State<VoiceSearchButton> {
  final SpeechToText _speech = SpeechToText();
  bool _listening = false;

  @override
  void dispose() {
    unawaited(_speech.stop());
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }

    final available = await _speech.initialize(
      onError: (error) => _showError(error.errorMsg),
      onStatus: (status) {
        if (status == 'done' || status == 'notListening') {
          if (mounted) setState(() => _listening = false);
        }
      },
    );

    if (!available) {
      _showError('Reconnaissance vocale indisponible sur cet appareil.');
      return;
    }

    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(localeId: 'fr_FR'),
      onResult: (result) {
        if (!result.finalResult) return;
        widget.onResult(result.recognizedWords);
      },
    );
  }

  void _showError(String message) {
    if (!mounted) return;
    setState(() => _listening = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return IconButton(
      onPressed: _toggle,
      tooltip: 'Recherche vocale',
      icon: Icon(
        _listening ? Icons.mic : Icons.mic_none,
        color: _listening ? theme.colorScheme.error : null,
      ),
    );
  }
}
