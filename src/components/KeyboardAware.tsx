/**
 * KeyboardAwareScreen - one wrapper for every screen with text inputs.
 *
 * It keeps the focused input and the submit button above the on-screen
 * keyboard. On iOS that means padding the layout; on Android the window is
 * already resized (adjustResize in the manifest) so `height` keeps the
 * scroll view usable as well.
 *
 * Tapping a non-input area or dragging the list dismisses the keyboard:
 * `keyboardShouldPersistTaps="handled"` lets taps reach buttons and inputs,
 * and `keyboardDismissMode` handles the drag.
 */
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function KeyboardAwareScreen({
  children,
  style,
  contentContainerStyle,
  refreshControl,
  maxWidth,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Set to keep long forms and lists from stretching on tablets. */
  maxWidth?: number;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      style={styles.flex}
    >
      <ScrollView
        style={[styles.flex, style]}
        contentContainerStyle={[maxWidth ? {width: '100%', maxWidth, alignSelf: 'center'} : null, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={false}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1, backgroundColor: 'transparent'},
});
