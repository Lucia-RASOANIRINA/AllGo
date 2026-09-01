import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  ConsumerState<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  String section = 'users';
  List<dynamic> rows = const [];
  bool loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => loading = true);
    final response = await ref.read(apiClientProvider).get<dynamic>('/admin/$section');
    if (!mounted) return;
    final data = response.data;
    setState(() {
      rows = data is Map && data['data'] is List ? data['data'] as List : data is List ? data : const [];
      loading = false;
    });
  }

  String _title(dynamic item) => section == 'users'
      ? '${item['firstName'] ?? ''} ${item['lastName'] ?? ''}'
      : item['name']?.toString() ?? item['orderNumber']?.toString() ?? 'Élément';

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Administration AllGo')),
    body: Column(children: [
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.all(8),
        child: Row(children: ['users', 'shops', 'products', 'orders'].map((value) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ChoiceChip(label: Text(value == 'users' ? 'Utilisateurs' : value == 'shops' ? 'Boutiques' : value == 'products' ? 'Produits' : 'Commandes'), selected: section == value, onSelected: (_) { setState(() => section = value); _load(); }),
        )).toList()),
      ),
      Expanded(child: loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
        onRefresh: _load,
        child: ListView.builder(
          itemCount: rows.length,
          itemBuilder: (_, index) {
            final item = rows[index] as Map;
            return ListTile(
              title: Text(_title(item)),
              subtitle: Text('${item['status'] ?? ''} ${item['phone'] ?? ''}'),
              trailing: Text(item['createdAt']?.toString().substring(0, 10) ?? ''),
            );
          },
        ),
      )),
    ]),
  );
}
