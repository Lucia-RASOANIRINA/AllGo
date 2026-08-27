import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _bio = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _uploadingPhoto = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _email.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me');
      final data = response.data?['data'];
      if (data is Map<String, dynamic>) {
        _firstName.text = data['firstName'] as String? ?? '';
        _lastName.text = data['lastName'] as String? ?? '';
        _email.text = data['email'] as String? ?? '';
        _bio.text = data['bio'] as String? ?? '';
      }
    } on DioException catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      await ref.read(apiClientProvider).patch<Map<String, dynamic>>(
        '/me',
        data: <String, dynamic>{
          'firstName': _firstName.text.trim(),
          'lastName': _lastName.text.trim(),
          if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
          'bio': _bio.text.trim(),
        },
      );
      await ref.read(sessionControllerProvider.notifier).refresh();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profil enregistré.')));
    } on DioException catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickPhoto() async {
    final image = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 82);
    if (image == null) return;
    setState(() => _uploadingPhoto = true);
    try {
      final bytes = await image.readAsBytes();
      final api = ref.read(apiClientProvider);
      final upload = await api.post<Map<String, dynamic>>(
        '/media/upload-url',
        data: <String, dynamic>{'type': 'image/jpeg', 'size': bytes.length},
      );
      final data = upload.data?['data'];
      if (data is! Map<String, dynamic>) throw const FormatException('Réponse média invalide.');
      await api.put<void>(
        data['uploadUrl'] as String,
        data: bytes,
        options: Options(
          headers: <String, dynamic>{
            'Content-Type': 'image/jpeg',
            'Content-Length': bytes.length,
          },
        ),
      );
      await api.patch<void>('/me', data: <String, String>{'avatarKey': data['key'] as String});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Photo mise à jour.')));
    } on DioException catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  void _showError(DioException error) {
    final body = error.response?.data;
    final message = body is Map<String, dynamic> ? body['message'] as String? : null;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message ?? 'Impossible de charger le profil.')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mon profil')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                children: <Widget>[
                  Center(
                    child: Stack(
                      alignment: Alignment.bottomRight,
                      children: <Widget>[
                        const CircleAvatar(radius: 42, child: Icon(Icons.person, size: 42)),
                        IconButton.filled(
                          onPressed: _uploadingPhoto ? null : _pickPhoto,
                          icon: _uploadingPhoto
                              ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.camera_alt_outlined),
                          tooltip: 'Modifier la photo de profil',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AllGoTokens.space6),
                  TextFormField(controller: _firstName, decoration: const InputDecoration(labelText: 'Prénom'), validator: _required),
                  const SizedBox(height: AllGoTokens.space3),
                  TextFormField(controller: _lastName, decoration: const InputDecoration(labelText: 'Nom'), validator: _required),
                  const SizedBox(height: AllGoTokens.space3),
                  TextFormField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress),
                  const SizedBox(height: AllGoTokens.space3),
                  TextFormField(controller: _bio, decoration: const InputDecoration(labelText: 'Présentation'), maxLength: 500, maxLines: 3),
                  const SizedBox(height: AllGoTokens.space4),
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
                    label: Text(_saving ? 'Enregistrement...' : 'Enregistrer'),
                  ),
                ],
              ),
            ),
    );
  }

  String? _required(String? value) => value == null || value.trim().isEmpty ? 'Champ requis' : null;
}
