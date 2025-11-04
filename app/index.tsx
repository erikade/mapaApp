import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  TouchableOpacity,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../config/supabase';
import axios from 'axios';

// Interfaces TypeScript
interface LocationData {
  latitude: number;
  longitude: number;
}

interface SavedLocation {
  id: string;
  latitude: number;
  longitude: number;
  address: string;
  created_at: string;
}

interface ReverseGeocodeResponse {
  address: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    state?: string;
    country?: string;
  };
  display_name?: string;
}

const App: React.FC = () => {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [address, setAddress] = useState<string>('');
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);

  // Solicitar permissões de localização - MÉTODO CORRETO PARA EXPO
  const requestLocationPermission = async (): Promise<boolean> => {
    try {
      console.log('Solicitando permissão de localização...');
      
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      const isGranted = status === 'granted';
      setPermissionGranted(isGranted);
      
      console.log('Status da permissão:', status);
      
      if (!isGranted) {
        Alert.alert(
          'Permissão Necessária', 
          'Este app precisa de acesso à sua localização para funcionar corretamente.',
          [
            {
              text: 'Configurar',
              onPress: () => Linking.openSettings()
            },
            {
              text: 'Cancelar',
              style: 'cancel'
            }
          ]
        );
      }
      
      return isGranted;
    } catch (error) {
      console.error('Erro na permissão:', error);
      setPermissionGranted(false);
      return false;
    }
  };

  // Obter localização atual - MÉTODO CORRETO PARA EXPO
  const getCurrentLocation = async (): Promise<void> => {
    try {
      console.log('Iniciando busca de localização...');
      
      // Verificar permissão primeiro
      if (!permissionGranted) {
        const hasPermission = await requestLocationPermission();
        if (!hasPermission) {
          Alert.alert('Permissão Negada', 'Não é possível acessar a localização sem permissão.');
          return;
        }
      }

      setLoading(true);
      
      // Obter localização atual
      const locationResult = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeout: 15000,
      });

      console.log('Localização obtida:', locationResult.coords);
      
      const newLocation: LocationData = {
        latitude: locationResult.coords.latitude,
        longitude: locationResult.coords.longitude,
      };
      
      setLocation(newLocation);
      await reverseGeocode(newLocation.latitude, newLocation.longitude);
      
    } catch (error: any) {
      console.error('Erro ao obter localização:', error);
      
      let errorMessage = 'Não foi possível obter a localização';
      
      if (error.code === 'PERMISSION_DENIED') {
        errorMessage = 'Permissão de localização negada. Verifique as configurações do app.';
      } else if (error.code === 'POSITION_UNAVAILABLE') {
        errorMessage = 'Serviço de localização indisponível. Verifique se o GPS está ativado.';
      } else if (error.code === 'TIMEOUT') {
        errorMessage = 'Tempo limite excedido ao buscar localização. Tente novamente.';
      }
      
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Monitorar localização em tempo real (opcional)
  const startLocationWatch = async (): Promise<void> => {
    try {
      await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        },
        (newLocation) => {
          const coords = newLocation.coords;
          setLocation({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          reverseGeocode(coords.latitude, coords.longitude);
        }
      );
    } catch (error) {
      console.error('Erro ao monitorar localização:', error);
    }
  };

  // Abrir no Google Maps
  const openInMaps = (): void => {
    if (!location) return;
    
    const url = Platform.select({
      ios: `maps://?q=${location.latitude},${location.longitude}`,
      android: `geo:${location.latitude},${location.longitude}?q=${location.latitude},${location.longitude}`,
      default: `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
    });

    Linking.openURL(url!).catch(err => {
      Alert.alert('Erro', 'Não foi possível abrir o mapa');
      console.log(err);
    });
  };

  // Geocodificação reversa (coordenadas para endereço)
  const reverseGeocode = async (lat: number, lng: number): Promise<void> => {
    try {
      console.log('Buscando endereço para:', lat, lng);
      
      const response = await axios.get<ReverseGeocodeResponse>(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );
      
      if (response.data) {
        let formattedAddress = '';
        
        if (response.data.display_name) {
          formattedAddress = response.data.display_name;
        } else if (response.data.address) {
          const addr = response.data.address;
          const parts = [
            addr.road,
            addr.house_number ? `Nº ${addr.house_number}` : '',
            addr.suburb,
            addr.city || addr.town || addr.village,
            addr.state,
            addr.country
          ].filter(Boolean);
          
          formattedAddress = parts.join(', ');
        }
        
        setAddress(formattedAddress || 'Endereço não disponível');
        console.log('Endereço encontrado:', formattedAddress);
      }
    } catch (error) {
      console.log('Erro na geocodificação reversa:', error);
      setAddress('Erro ao buscar endereço');
    }
  };

  // Salvar localização no Supabase
  const saveLocation = async (): Promise<void> => {
    if (!location) {
      Alert.alert('Aviso', 'Nenhuma localização disponível para salvar');
      return;
    }

    try {
      const locationData = {
        latitude: location.latitude,
        longitude: location.longitude,
        address: address || 'Endereço não disponível',
        created_at: new Date().toISOString(),
      };

      console.log('Salvando localização:', locationData);

      const { data, error } = await supabase
        .from('locations')
        .insert([locationData])
        .select();

      if (error) {
        console.error('Erro Supabase:', error);
        throw error;
      }

      Alert.alert('✅ Sucesso', 'Localização salva com sucesso!');
      loadSavedLocations();
    } catch (error) {
      console.error('Erro ao salvar:', error);
      Alert.alert('❌ Erro', 'Não foi possível salvar a localização');
    }
  };

  // Carregar localizações salvas
  const loadSavedLocations = async (): Promise<void> => {
    try {
      console.log('Carregando localizações salvas...');
      
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erro ao carregar:', error);
        throw error;
      }

      console.log('Localizações carregadas:', data?.length || 0);
      setSavedLocations(data || []);
    } catch (error) {
      console.error('Erro ao carregar localizações:', error);
      Alert.alert('Erro', 'Não foi possível carregar as localizações salvas');
    }
  };

  // Verificar permissões na inicialização
  useEffect(() => {
    const checkPermissions = async (): Promise<void> => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        setPermissionGranted(status === 'granted');
        console.log('Status inicial da permissão:', status);
      } catch (error) {
        console.error('Erro ao verificar permissões:', error);
      }
    };

    checkPermissions();
    loadSavedLocations();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🗺️ App de Geolocalização</Text>
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Informações de Localização */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Sua Localização Atual</Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>🌐 Latitude:</Text>
              <Text style={styles.value}>
                {location ? location.latitude.toFixed(6) : '---'}
              </Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.label}>🌐 Longitude:</Text>
              <Text style={styles.value}>
                {location ? location.longitude.toFixed(6) : '---'}
              </Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.label}>🏠 Endereço:</Text>
              <Text style={[styles.value, styles.address]}>
                {address || (loading ? 'Buscando endereço...' : 'Nenhuma localização')}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>🔒 Permissão:</Text>
              <Text style={styles.value}>
                {permissionGranted ? '✅ Concedida' : '❌ Negada'}
              </Text>
            </View>
          </View>

          {/* Controles */}
          <View style={styles.controls}>
            <TouchableOpacity 
              style={[
                styles.button, 
                styles.primaryButton,
                loading && styles.buttonDisabled
              ]}
              onPress={getCurrentLocation}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? '🔄 Buscando Localização...' : '📍 Buscar Minha Localização'}
              </Text>
            </TouchableOpacity>

            <View style={styles.buttonRow}>
              <TouchableOpacity 
                style={[
                  styles.button, 
                  styles.secondaryButton,
                  (!location || loading) && styles.buttonDisabled
                ]}
                onPress={saveLocation}
                disabled={!location || loading}
              >
                <Text style={styles.buttonText}>💾 Salvar Local</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[
                  styles.button, 
                  styles.mapsButton,
                  (!location || loading) && styles.buttonDisabled
                ]}
                onPress={openInMaps}
                disabled={!location || loading}
              >
                <Text style={styles.buttonText}>🗺️ Abrir no Maps</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Localizações Salvas */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>💾 Localizações Salvas</Text>
            <TouchableOpacity 
              style={styles.refreshButton}
              onPress={loadSavedLocations}
            >
              <Text style={styles.refreshText}>🔄 Atualizar</Text>
            </TouchableOpacity>
          </View>
          
          {savedLocations.length > 0 ? (
            savedLocations.map((loc, index) => (
              <View key={loc.id} style={styles.savedLocationCard}>
                <View style={styles.locationHeader}>
                  <Text style={styles.savedLocationTitle}>📍 Local {index + 1}</Text>
                  <TouchableOpacity 
                    onPress={() => Linking.openURL(
                      `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`
                    )}
                  >
                    <Text style={styles.openMapText}>🗺️ Abrir</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Coordenadas:</Text>
                  <Text style={styles.value}>
                    {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                  </Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Endereço:</Text>
                  <Text style={[styles.value, styles.address]}>{loc.address}</Text>
                </View>
                
                <Text style={styles.savedLocationDate}>
                  📅 {new Date(loc.created_at).toLocaleString('pt-BR')}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.noDataText}>📭 Nenhuma localização salva</Text>
              <Text style={styles.noDataSubtext}>
                Busque sua localização e clique em "Salvar Local" para começar
              </Text>
            </View>
          )}
        </View>

        {/* Estatísticas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Estatísticas</Text>
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{savedLocations.length}</Text>
              <Text style={styles.statLabel}>Locais Salvos</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>
                {location ? '✅' : '❌'}
              </Text>
              <Text style={styles.statLabel}>Localização</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>
                {permissionGranted ? '✅' : '❌'}
              </Text>
              <Text style={styles.statLabel}>Permissão</Text>
            </View>
          </View>
        </View>

        {/* Instruções */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ Como Usar</Text>
          <View style={styles.instructionsCard}>
            <Text style={styles.instruction}>1. 📍 Clique em "Buscar Minha Localização"</Text>
            <Text style={styles.instruction}>2. 🔒 Conceda a permissão de localização</Text>
            <Text style={styles.instruction}>3. 💾 Salve a localização se desejar</Text>
            <Text style={styles.instruction}>4. 🗺️ Abra no mapa para ver no Google Maps</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

// STYLES FUTURISTAS
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#00ff88',
    textShadowColor: '#00ff88',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  refreshButton: {
    padding: 8,
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  refreshText: {
    color: '#00ff88',
    fontWeight: '600',
    fontSize: 12,
  },
  infoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.2)',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  label: {
    fontWeight: '600',
    color: '#00ff88',
    fontSize: 14,
    flex: 1,
    letterSpacing: 0.3,
  },
  value: {
    color: '#ffffff',
    fontSize: 14,
    flex: 2,
    textAlign: 'right',
    fontWeight: '500',
  },
  address: {
    fontStyle: 'italic',
    textAlign: 'left',
    color: '#cccccc',
  },
  controls: {
    marginTop: 25,
    gap: 15,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 15,
  },
  button: {
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: 'rgba(0, 255, 136, 0.15)',
    borderColor: '#00ff88',
  },
  secondaryButton: {
    backgroundColor: 'rgba(108, 117, 125, 0.15)',
    borderColor: '#6c757d',
  },
  mapsButton: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    borderColor: '#34C759',
  },
  buttonDisabled: {
    backgroundColor: 'rgba(189, 195, 199, 0.1)',
    borderColor: 'rgba(189, 195, 199, 0.3)',
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  savedLocationCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 22,
    borderRadius: 18,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  locationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  savedLocationTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#00ff88',
    letterSpacing: 0.3,
  },
  openMapText: {
    color: '#00ff88',
    fontWeight: '600',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  savedLocationDate: {
    fontSize: 12,
    color: '#888888',
    marginTop: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  emptyState: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 50,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 255, 136, 0.1)',
    borderStyle: 'dashed',
  },
  noDataText: {
    fontSize: 18,
    color: '#00ff88',
    marginBottom: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#aaaaaa',
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  statsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 30,
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.2)',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00ff88',
    marginBottom: 8,
    textShadowColor: '#00ff88',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#cccccc',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  instructionsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  instruction: {
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 12,
    lineHeight: 22,
    letterSpacing: 0.2,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#00ff88',
  },
});

export default App;