import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/splash_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Écran de démarrage affiche le logo, le nom et un indicateur',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashScreen()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('AllGo'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byType(AllGoLogo), findsOneWidget);
  });
}
